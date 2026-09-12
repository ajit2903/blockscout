#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "Usage: $0 ETHERSCAN_API_KEY RPC_URL(or empty) ADDRESS"
  echo "Example: $0 MYKEY https://mainnet.infura.io/v3/MYKEY 0x06ee840642a33367ee59fca237f270d5119d1356"
  exit 1
fi

API_KEY="$1"
RPC_URL="$2"
ADDRESS="$3"
ADDRESS_LC="$(echo "$ADDRESS" | tr '[:upper:]' '[:lower:]')"
OUTDIR="./out-all-deposits"
PAGESIZE=1000
mkdir -p "$OUTDIR"

# Fetch paginated results for a given module/action
fetch_pages() {
  local module="$1" action="$2" outfile="$3"
  local page=1
  : > "$outfile"
  while :; do
    url="https://api.etherscan.io/api?module=${module}&action=${action}&address=${ADDRESS}&startblock=0&endblock=99999999&page=${page}&offset=${PAGESIZE}&sort=asc&apikey=${API_KEY}"
    echo "Fetching ${module}.${action} page ${page}..."
    resp=$(curl -s "$url")
    # If API returned an error with empty result, break
    results_count=$(echo "$resp" | jq '.result | length' 2>/dev/null || echo 0)
    if [ "$results_count" -eq 0 ]; then
      break
    fi
    page_results=$(echo "$resp" | jq '.result')
    if [ "$page" -eq 1 ]; then
      echo "$page_results" > "$outfile"
    else
      jq -s '.[0] + .[1]' "$outfile" <(echo "$page_results") > "${outfile}.tmp" && mv "${outfile}.tmp" "$outfile"
    fi
    if [ "$(echo "$page_results" | jq 'length')" -lt "$PAGESIZE" ]; then
      break
    fi
    page=$((page+1))
    sleep 0.2
  done
}

echo "1) Fetch normal transactions (txlist)..."
fetch_pages account txlist "${OUTDIR}/txlist.json"
echo "2) Fetch internal transactions (txlistinternal)..."
fetch_pages account txlistinternal "${OUTDIR}/internal.json"
echo "3) Fetch ERC-20 token transfers (tokentx)..."
fetch_pages account tokentx "${OUTDIR}/token_transfers.json"

# Derive deposits/withdrawals (normal + internal + tokens)
echo "4) Filter deposits & withdrawals..."
jq --arg addr "$ADDRESS_LC" '[.[] | select((.to // "" | ascii_downcase) == $addr)]' "${OUTDIR}/txlist.json" > "${OUTDIR}/deposits_native.json"
jq --arg addr "$ADDRESS_LC" '[.[] | select((.from // "" | ascii_downcase) == $addr)]' "${OUTDIR}/txlist.json" > "${OUTDIR}/withdrawals_native.json"
jq --arg addr "$ADDRESS_LC" '[.[] | select((.to // "" | ascii_downcase) == $addr)]' "${OUTDIR}/internal.json" > "${OUTDIR}/deposits_internal.json"
jq --arg addr "$ADDRESS_LC" '[.[] | select((.from // "" | ascii_downcase) == $addr)]' "${OUTDIR}/internal.json" > "${OUTDIR}/withdrawals_internal.json"
jq --arg addr "$ADDRESS_LC" '[.[] | select((.to // "" | ascii_downcase) == $addr)]' "${OUTDIR}/token_transfers.json" > "${OUTDIR}/deposits_tokens.json"
jq --arg addr "$ADDRESS_LC" '[.[] | select((.from // "" | ascii_downcase) == $addr)]' "${OUTDIR}/token_transfers.json" > "${OUTDIR}/withdrawals_tokens.json"

# CSV exports (native only)
echo "5) Make CSVs for native transfers..."
jq -r '.[] | [.blockNumber, .timeStamp, .hash, .from, .to, (.value|tonumber/1e18)] | @csv' "${OUTDIR}/deposits_native.json" > "${OUTDIR}/deposits_native.csv" || true
jq -r '.[] | [.blockNumber, .timeStamp, .hash, .from, .to, (.value|tonumber/1e18)] | @csv' "${OUTDIR}/withdrawals_native.json" > "${OUTDIR}/withdrawals_native.csv" || true

# Earliest incoming transfer (normal + internal)
echo "6) Find earliest incoming (normal + internal)..."
jq -s --arg addr "$ADDRESS_LC" '
  (.[0] // []) + (.[1] // []) |
  map(
    . as $it |
    # normalize fields present in both types
    {
      kind: (if $it.blockNumber? then "normal" else "internal" end),
      blockNumber: ($it.blockNumber // $it.blockNumber // "0"),
      timeStamp: ($it.timeStamp // ($it.timeStamp // "0")),
      hash: ($it.hash // $it.transactionHash // null),
      from: ($it.from // null),
      to: ($it.to // null),
      value: ($it.value // ($it.value // "0"))
    }
  ) |
  map(select((.to // "" | ascii_downcase) == $addr)) |
  map(.timeNum = (try (.timeStamp|tonumber) catch 0 end) ) |
  sort_by(.timeNum, (.blockNumber|tonumber)) |
  .[0]
' "${OUTDIR}/txlist.json" "${OUTDIR}/internal.json" > "${OUTDIR}/earliest_incoming.json"

if [ ! -s "${OUTDIR}/earliest_incoming.json" ] || [ "$(jq -r '.' "${OUTDIR}/earliest_incoming.json")" = "null" ]; then
  echo "No incoming normal/internal transactions found for ${ADDRESS} (via Etherscan)."
else
  echo "Earliest incoming transfer (raw JSON):"
  jq '.' "${OUTDIR}/earliest_incoming.json"
  echo
  echo "Summary:"
  jq -r '. | "block: \(.blockNumber)  timeStamp: \(.timeStamp)  txHash: \(.hash)\nfrom: \(.from)\nto: \(.to)\nvalue (wei): \(.value)\nvalue (ETH): \((.value|tonumber/1e18))"' "${OUTDIR}/earliest_incoming.json"
fi

# Optionally run the repo's check-blocks.js to cross-verify (requires RPC_URL)
if [ -n "$RPC_URL" ]; then
  echo
  echo "7) Running repo scanner scripts/check-blocks.js for a small recent range to cross-check (requires Node >=20 and npm install)..."
  if ! command -v node >/dev/null 2>&1; then
    echo "node not found in PATH; skipping repo scan."
  else
    # ensure deps installed (optional): uncomment if you want the script to install deps automatically
    # npm ci
    # scan recent 100 blocks (uses check-blocks.js's BLOCK_COUNT env)
    RPC_URL_ESCAPED="$RPC_URL"
    echo "Running: RPC_URL='${RPC_URL_ESCAPED}' TARGET_ADDRESS='${ADDRESS}' BLOCK_COUNT=100 node scripts/check-blocks.js | tee ${OUTDIR}/check-blocks.log"
    RPC_URL="${RPC_URL_ESCAPED}" TARGET_ADDRESS="${ADDRESS}" BLOCK_COUNT=100 node scripts/check-blocks.js | tee "${OUTDIR}/check-blocks.log" || true
    echo "Repo scanner log: ${OUTDIR}/check-blocks.log"
  fi
fi

echo
echo "Completed. Outputs are in ${OUTDIR}/"
echo "Key files:"
echo " - ${OUTDIR}/deposits_native.json, ${OUTDIR}/deposits_native.csv"
echo " - ${OUTDIR}/withdrawals_native.json, ${OUTDIR}/withdrawals_native.csv"
echo " - ${OUTDIR}/deposits_internal.json, ${OUTDIR}/withdrawals_internal.json"
echo " - ${OUTDIR}/deposits_tokens.json, ${OUTDIR}/withdrawals_tokens.json"
echo " - ${OUTDIR}/earliest_incoming.json"
echo "If you want staking (ETH2 deposit contract) events or L2 bridge events included, I can add those steps."
