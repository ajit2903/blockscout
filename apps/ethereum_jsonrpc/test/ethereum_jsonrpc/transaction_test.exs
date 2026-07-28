defmodule EthereumJSONRPC.TransactionTest do
  use ExUnit.Case, async: true

  doctest EthereumJSONRPC.Transaction

  alias EthereumJSONRPC.Transaction

  describe "to_elixir/1" do
    test "skips unsupported keys" do
      map = %{"key" => "value", "key1" => "value1"}

      assert %{ignore: :ignore} = Transaction.to_elixir(map)
    end

    test "converts authorizationList entries to signed authorization params" do
      map = %{
        "authorizationList" => [
          %{
            "chainId" => "0x1",
            "address" => "0x1234567890123456789012345678901234567890",
            "nonce" => "0x0",
            "r" => "0x1",
            "s" => "0x2",
            "v" => "0x0"
          }
        ]
      }

      assert %{
               "authorizationList" => [
                 %{
                   chain_id: 1,
                   address: "0x1234567890123456789012345678901234567890",
                   nonce: 0,
                   r: 1,
                   s: 2,
                   v: 0
                 }
               ]
             } = Transaction.to_elixir(map)
    end

    test "converts an empty authorizationList to an empty list" do
      assert %{"authorizationList" => []} = Transaction.to_elixir(%{"authorizationList" => []})
    end

    test "converts multiple authorizationList entries preserving order" do
      map = %{
        "authorizationList" => [
          %{"chainId" => "0x1", "address" => "0xa", "nonce" => "0x0", "r" => "0x1", "s" => "0x1", "v" => "0x0"},
          %{"chainId" => "0x2", "address" => "0xb", "nonce" => "0x1", "r" => "0x2", "s" => "0x2", "v" => "0x1"}
        ]
      }

      assert %{"authorizationList" => [first, second]} = Transaction.to_elixir(map)
      assert first.chain_id == 1
      assert first.address == "0xa"
      assert second.chain_id == 2
      assert second.address == "0xb"
    end
  end

  describe "elixir_to_params/1" do
    test "includes authorization_list when authorizationList is present" do
      authorization_list = [
        %{chain_id: 1, address: "0xa", nonce: 0, r: 1, s: 2, v: 0}
      ]

      elixir = %{
        "blockHash" => "0x4e3a3754410177e6937ef1f84bba68ea139e8d1a2258c5f85db9f1cd715a1bdd",
        "blockNumber" => 46147,
        "from" => "0xa1e4380a3b1f749673e270229993ee55f35663b4",
        "gas" => 21000,
        "gasPrice" => 50_000_000_000_000,
        "hash" => "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060",
        "input" => "0x",
        "nonce" => 0,
        "r" => 1,
        "s" => 2,
        "to" => "0x5df9b87991262f6ba471f09758cde1c0fc1de734",
        "transactionIndex" => 0,
        "type" => 4,
        "v" => 28,
        "value" => 31337,
        "maxPriorityFeePerGas" => 0,
        "maxFeePerGas" => 0,
        "authorizationList" => authorization_list
      }

      assert %{authorization_list: ^authorization_list} = Transaction.elixir_to_params(elixir)
    end

    test "does not add authorization_list key when authorizationList is absent" do
      elixir = %{
        "blockHash" => "0x4e3a3754410177e6937ef1f84bba68ea139e8d1a2258c5f85db9f1cd715a1bdd",
        "blockNumber" => 46147,
        "from" => "0xa1e4380a3b1f749673e270229993ee55f35663b4",
        "gas" => 21000,
        "gasPrice" => 50_000_000_000_000,
        "hash" => "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060",
        "input" => "0x",
        "nonce" => 0,
        "r" => 1,
        "s" => 2,
        "to" => "0x5df9b87991262f6ba471f09758cde1c0fc1de734",
        "transactionIndex" => 0,
        "type" => 2,
        "v" => 28,
        "value" => 31337,
        "maxPriorityFeePerGas" => 0,
        "maxFeePerGas" => 0
      }

      refute Map.has_key?(Transaction.elixir_to_params(elixir), :authorization_list)
    end
  end
end
