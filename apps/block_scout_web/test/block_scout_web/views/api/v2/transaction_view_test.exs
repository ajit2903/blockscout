defmodule BlockScoutWeb.API.V2.TransactionViewTest do
  use BlockScoutWeb.ConnCase, async: true

  alias BlockScoutWeb.API.V2.TransactionView
  alias Ecto.Association.NotLoaded
  alias Explorer.Chain.{Address, Transaction, Wei}
  alias Explorer.Chain.SignedAuthorization

  describe "decode_logs/2" do
    test "doesn't use decoding candidate event with different 2nd, 3d or 4th topic" do
      insert(:contract_method,
        identifier: Base.decode16!("d20a68b2", case: :lower),
        abi: %{
          "name" => "OptionSettled",
          "type" => "event",
          "inputs" => [
            %{"name" => "accountId", "type" => "uint256", "indexed" => true, "internalType" => "uint256"},
            %{"name" => "option", "type" => "address", "indexed" => false, "internalType" => "address"},
            %{"name" => "subId", "type" => "uint256", "indexed" => false, "internalType" => "uint256"},
            %{"name" => "amount", "type" => "int256", "indexed" => false, "internalType" => "int256"},
            %{"name" => "value", "type" => "int256", "indexed" => false, "internalType" => "int256"}
          ],
          "anonymous" => false
        }
      )

      topic1_bytes = ExKeccak.hash_256("OptionSettled(uint256,address,uint256,int256,int256)")
      topic1 = "0x" <> Base.encode16(topic1_bytes, case: :lower)
      log1_topic2 = "0x0000000000000000000000000000000000000000000000000000000000005d19"
      log2_topic2 = "0x000000000000000000000000000000000000000000000000000000000000634a"

      log1_data =
        "0x000000000000000000000000aeb81cbe6b19ceeb0dbe0d230cffe35bb40a13a700000000000000000000000000000000000000000000045d964b80006597b700fffffffffffffffffffffffffffffffffffffffffffffffffe55aca2c2f40000ffffffffffffffffffffffffffffffffffffffffffffffe3a8289da3d7a13ef2"

      log2_data =
        "0x000000000000000000000000aeb81cbe6b19ceeb0dbe0d230cffe35bb40a13a700000000000000000000000000000000000000000000045d964b80006597b700000000000000000000000000000000000000000000000000011227ebced227ae00000000000000000000000000000000000000000000001239fdf180a3d6bd85"

      transaction = insert(:transaction)

      log1 =
        insert(:log,
          transaction: transaction,
          first_topic: topic(topic1),
          second_topic: topic(log1_topic2),
          third_topic: nil,
          fourth_topic: nil,
          data: log1_data
        )

      log2 =
        insert(:log,
          transaction: transaction,
          first_topic: topic(topic1),
          second_topic: topic(log2_topic2),
          third_topic: nil,
          fourth_topic: nil,
          data: log2_data
        )

      logs = [log1, log2]

      assert [
               {:ok, "d20a68b2",
                "OptionSettled(uint256 indexed accountId, address option, uint256 subId, int256 amount, int256 value)",
                [
                  {"accountId", "uint256", true, 23833},
                  {"option", "address", false,
                   <<174, 184, 28, 190, 107, 25, 206, 235, 13, 190, 13, 35, 12, 255, 227, 91, 180, 10, 19, 167>>},
                  {"subId", "uint256", false, 20_615_843_020_801_704_441_600},
                  {"amount", "int256", false, -120_000_000_000_000_000},
                  {"value", "int256", false, -522_838_470_013_113_778_446}
                ]},
               {:ok, "d20a68b2",
                "OptionSettled(uint256 indexed accountId, address option, uint256 subId, int256 amount, int256 value)",
                [
                  {"accountId", "uint256", true, 25418},
                  {"option", "address", false,
                   <<174, 184, 28, 190, 107, 25, 206, 235, 13, 190, 13, 35, 12, 255, 227, 91, 180, 10, 19, 167>>},
                  {"subId", "uint256", false, 20_615_843_020_801_704_441_600},
                  {"amount", "int256", false, 77_168_037_359_396_782},
                  {"value", "int256", false, 336_220_154_890_848_484_741}
                ]}
             ] = TransactionView.decode_logs(logs, false)
    end
  end

  describe "render(\"authorization_list.json\")" do
    test "sorts signed authorizations by index ascending and maps their fields" do
      transaction = insert(:transaction)

      authorization_2 = insert(:signed_authorization, transaction_hash: transaction.hash, index: 2)
      authorization_0 = insert(:signed_authorization, transaction_hash: transaction.hash, index: 0)
      authorization_1 = insert(:signed_authorization, transaction_hash: transaction.hash, index: 1)

      rendered =
        TransactionView.render("authorization_list.json", %{
          signed_authorizations: [authorization_2, authorization_0, authorization_1]
        })

      assert [item_0, item_1, item_2] = rendered

      assert item_0 == TransactionView.prepare_signed_authorization(authorization_0)
      assert item_1 == TransactionView.prepare_signed_authorization(authorization_1)
      assert item_2 == TransactionView.prepare_signed_authorization(authorization_2)
    end

    test "returns an empty list when given no signed authorizations" do
      assert TransactionView.render("authorization_list.json", %{signed_authorizations: []}) == []
    end
  end

  describe "prepare_signed_authorization/1" do
    test "maps all fields of the signed authorization" do
      signed_authorization = %SignedAuthorization{
        address: address_hash(),
        chain_id: 1,
        nonce: 5,
        r: Decimal.new(123),
        s: Decimal.new(456),
        v: 1,
        authority: address_hash()
      }

      assert TransactionView.prepare_signed_authorization(signed_authorization) == %{
               "address" => signed_authorization.address,
               "chain_id" => 1,
               "nonce" => 5,
               "r" => Decimal.new(123),
               "s" => Decimal.new(456),
               "v" => 1,
               "authority" => signed_authorization.authority
             }
    end

    test "authority may be nil when it could not be recovered" do
      signed_authorization = %SignedAuthorization{
        address: address_hash(),
        chain_id: 1,
        nonce: 0,
        r: Decimal.new(1),
        s: Decimal.new(1),
        v: 0,
        authority: nil
      }

      assert %{"authority" => nil} = TransactionView.prepare_signed_authorization(signed_authorization)
    end
  end

  describe "authorization_list/1" do
    test "returns an empty list when signed_authorizations is nil" do
      assert TransactionView.authorization_list(nil) == []
    end

    test "returns an empty list when signed_authorizations is not loaded" do
      assert TransactionView.authorization_list(%NotLoaded{}) == []
    end

    test "renders the list of signed authorizations when loaded" do
      transaction = insert(:transaction)
      signed_authorization = insert(:signed_authorization, transaction_hash: transaction.hash, index: 0)

      assert [rendered] = TransactionView.authorization_list([signed_authorization])
      assert rendered == TransactionView.prepare_signed_authorization(signed_authorization)
    end
  end

  describe "tx_types/3 :set_code_transaction stage" do
    test "includes :set_code_transaction for EIP-7702 set code transactions (type 4)" do
      transaction = plain_transaction(type: 4)

      assert :set_code_transaction in TransactionView.tx_types(transaction)
    end

    test "does not include :set_code_transaction for other transaction types" do
      transaction = plain_transaction(type: 2)

      refute :set_code_transaction in TransactionView.tx_types(transaction)
    end

    test "includes :blob_transaction for blob transactions (type 3), not :set_code_transaction" do
      transaction = plain_transaction(type: 3)

      types = TransactionView.tx_types(transaction)

      assert :blob_transaction in types
      refute :set_code_transaction in types
    end
  end

  defp plain_transaction(opts) do
    %Transaction{
      type: Keyword.fetch!(opts, :type),
      to_address_hash: address_hash(),
      to_address: %Address{contract_code: nil},
      value: %Wei{value: Decimal.new(0)},
      has_token_transfers: false
    }
  end

  defp topic(topic_hex_string) do
    {:ok, topic} = Explorer.Chain.Hash.Full.cast(topic_hex_string)
    topic
  end
end
