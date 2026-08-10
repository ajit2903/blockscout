defmodule Explorer.Chain.SignedAuthorizationTest do
  use Explorer.DataCase

  alias Ecto.Changeset
  alias Explorer.Chain.SignedAuthorization

  describe "changeset/2" do
    test "with valid attributes is valid" do
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

      assert %Changeset{valid?: true} = SignedAuthorization.changeset(%SignedAuthorization{}, params)
    end

    test "is valid without the optional authority field" do
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

      assert %Changeset{valid?: true} = SignedAuthorization.changeset(%SignedAuthorization{}, params)
    end

    test "with empty attributes is invalid" do
      changeset = SignedAuthorization.changeset(%SignedAuthorization{}, %{})

      refute changeset.valid?
    end

    for required_attr <- ~w(transaction_hash index chain_id address nonce r s v)a do
      test "is invalid when #{required_attr} is missing" do
        transaction = insert(:transaction)

        params =
          %{
            transaction_hash: transaction.hash,
            index: 0,
            chain_id: 1,
            address: address_hash(),
            nonce: 0,
            r: Decimal.new(1),
            s: Decimal.new(2),
            v: 1
          }
          |> Map.delete(unquote(required_attr))

        changeset = SignedAuthorization.changeset(%SignedAuthorization{}, params)

        refute changeset.valid?
        assert %{unquote(required_attr) => ["can't be blank"]} = changeset_errors(changeset)
      end
    end

    test "fails foreign key constraint when transaction does not exist" do
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

      assert {:error, changeset} =
               %SignedAuthorization{}
               |> SignedAuthorization.changeset(params)
               |> Repo.insert()

      assert %{transaction_hash: ["does not exist"]} = changeset_errors(changeset)
    end

    test "successfully inserts a valid signed authorization" do
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

      assert {:ok, %SignedAuthorization{} = signed_authorization} =
               %SignedAuthorization{}
               |> SignedAuthorization.changeset(params)
               |> Repo.insert()

      assert signed_authorization.transaction_hash == transaction.hash
      assert signed_authorization.chain_id == 1
    end
  end
end