# SPDX-License-Identifier: LicenseRef-Blockscout
import Config

~w(config config_helper.exs)
|> Path.join()
|> Code.eval_file()

# Keep only the configured deposit wallet address.
# NOTE: Replace this with the actual config key used by your deployment if needed.
config :explorer,
  deposit_wallet_addresses: [
    "0x06EE840642a33367ee59fCA237F270d5119d1356"
  ]
