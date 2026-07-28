defmodule Explorer.Chain.Import.Runner.SignedAuthorizationsTest do
  use Explorer.DataCase

  alias Ecto.Multi
  alias Explorer.Chain.SignedAuthorization
  alias Explorer.Chain.Import.Runner.SignedAuthorizations

  describe "ecto_schema_module/0" do
    test "returns SignedAuthorization" do
      assert SignedAuthorizations.ecto_schema_module() == SignedAuthorization
    end
  end

  describe "option_key/0" do
    test "returns :signed_authorizations" do
      assert SignedAuthorizations.option_key() == :signed_authorizations
    end
  end

  describe "timeout/0" do
    test "returns the configured timeout" do
      assert SignedAuthorizations.timeout() == 60_000
    end
  end

  describe "run/3" do
    test "inserts a new signed authorization" do
      transaction = insert(:transaction)

      params = %{
        transaction_hash: transaction.hash,
        index: 0,
        chain_id: 1,
        address: address_hash(),
        nonce: 0,
        r: Decimal.new(1),
        s: Decimal.new(2),
        v: 1,
        authority: address_hash()
      }

      assert {:ok, %{signed_authorizations: [signed_authorization]}} = run_signed_authorizations([params])

      assert signed_authorization.transaction_hash == transaction.hash
      assert signed_authorization.index == 0
      assert signed_authorization.chain_id == 1
      assert signed_authorization.address == params.address
      assert signed_authorization.authority == params.authority
    end

    test "inserts multiple signed authorizations for the same transaction, keyed by index" do
      transaction = insert(:transaction)

      params_list =
        for index <- 0..2 do
          %{
            transaction_hash: transaction.hash,
            index: index,
            chain_id: 1,
            address: address_hash(),
            nonce: index,
            r: Decimal.new(index + 1),
            s: Decimal.new(index + 1),
            v: 1
          }
        end

      assert {:ok, %{signed_authorizations: signed_authorizations}} = run_signed_authorizations(params_list)

      assert Enum.count(signed_authorizations) == 3
      assert Enum.map(signed_authorizations, & &1.index) |> Enum.sort() == [0, 1, 2]
    end

    test "inserts a signed authorization with authority nil when authority could not be recovered" do
      transaction = insert(:transaction)

      params = %{
        transaction_hash: transaction.hash,
        index: 0,
        chain_id: 1,
        address: address_hash(),
        nonce: 0,
        r: Decimal.new(1),
        s: Decimal.new(2),
        v: 1,
        authority: nil
      }

      assert {:ok, %{signed_authorizations: [signed_authorization]}} = run_signed_authorizations([params])

      assert is_nil(signed_authorization.authority)
    end

    test "updates existing signed authorization on conflict of transaction_hash and index" do
      transaction = insert(:transaction)

      params = %{
        transaction_hash: transaction.hash,
        index: 0,
        chain_id: 1,
        address: address_hash(),
        nonce: 0,
        r: Decimal.new(1),
        s: Decimal.new(2),
        v: 1
      }

      assert {:ok, _} = run_signed_authorizations([params])

      updated_address = address_hash()
      updated_params = %{params | address: updated_address, nonce: 5}

      assert {:ok, %{signed_authorizations: [updated]}} = run_signed_authorizations([updated_params])

      assert updated.address == updated_address
      assert updated.nonce == 5

      assert Repo.get_by(SignedAuthorization, transaction_hash: transaction.hash, index: 0).address ==
               updated_address
    end

    test "raises when the referenced transaction does not exist" do
      params = %{
        transaction_hash: transaction_hash(),
        index: 0,
        chain_id: 1,
        address: address_hash(),
        nonce: 0,
        r: Decimal.new(1),
        s: Decimal.new(2),
        v: 1
      }

      assert_raise Postgrex.Error, ~r/foreign_key_violation|violates foreign key constraint/, fn ->
        run_signed_authorizations([params])
      end
    end
  end

  defp run_signed_authorizations(changes_list) when is_list(changes_list) do
    Multi.new()
    |> SignedAuthorizations.run(changes_list, %{
      timeout: :infinity,
      timestamps: %{inserted_at: DateTime.utc_now(), updated_at: DateTime.utc_now()}
    })
    |> Repo.transaction()
  end
end