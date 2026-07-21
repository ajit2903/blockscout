defmodule EthereumJSONRPC.SignedAuthorizationTest do
  use ExUnit.Case, async: true

  alias EthereumJSONRPC.SignedAuthorization

  describe "to_params/1" do
    test "converts raw quantity-encoded authorization tuple to integer params" do
      raw = %{
        "chainId" => "0x1",
        "address" => "0x1234567890123456789012345678901234567890",
        "nonce" => "0x5",
        "r" => "0xabc",
        "s" => "0xdef",
        "v" => "0x1"
      }

      assert SignedAuthorization.to_params(raw) == %{
               chain_id: 1,
               address: "0x1234567890123456789012345678901234567890",
               nonce: 5,
               r: 2748,
               s: 3567,
               v: 1
             }
    end

    test "handles zero quantities" do
      raw = %{
        "chainId" => "0x0",
        "address" => "0x0000000000000000000000000000000000000000",
        "nonce" => "0x0",
        "r" => "0x0",
        "s" => "0x0",
        "v" => "0x0"
      }

      assert SignedAuthorization.to_params(raw) == %{
               chain_id: 0,
               address: "0x0000000000000000000000000000000000000000",
               nonce: 0,
               r: 0,
               s: 0,
               v: 0
             }
    end

    test "handles large hex-encoded quantities for r and s" do
      raw = %{
        "chainId" => "0x89",
        "address" => "0xaeb81cbe6b19ceeb0dbe0d230cffe35bb40a13a7",
        "nonce" => "0x2a",
        "r" => "0xad3733df250c87556335ffe46c23e34dbaffde93097ef92f52c88632a40f0c75",
        "s" => "0x72caddc0371451a58de2ca6ab64e0f586ccdb9465ff54e1c82564940e89291e3",
        "v" => "0x1c"
      }

      params = SignedAuthorization.to_params(raw)

      assert params.chain_id == 137
      assert params.address == "0xaeb81cbe6b19ceeb0dbe0d230cffe35bb40a13a7"
      assert params.nonce == 42
      assert params.v == 28

      assert params.r ==
               String.to_integer("ad3733df250c87556335ffe46c23e34dbaffde93097ef92f52c88632a40f0c75", 16)

      assert params.s ==
               String.to_integer("72caddc0371451a58de2ca6ab64e0f586ccdb9465ff54e1c82564940e89291e3", 16)
    end

    test "does not transform the address field" do
      address = "0x00112233445566778899aabbccddeeff0011223"

      raw = %{
        "chainId" => "0x1",
        "address" => address,
        "nonce" => "0x0",
        "r" => "0x1",
        "s" => "0x1",
        "v" => "0x0"
      }

      assert %{address: ^address} = SignedAuthorization.to_params(raw)
    end
  end
end