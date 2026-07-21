defmodule Explorer.Chain.TokenTransferTest do
  use Explorer.DataCase

  import Ecto.Query
  import Explorer.Factory

  alias Explorer.{PagingOptions, Repo}
  alias Explorer.Chain.{Transaction, TokenTransfer}

  doctest Explorer.Chain.TokenTransfer

  describe "fetch_token_transfers/2" do
    test "returns token transfers for the given address" do
      token_contract_address = insert(:contract_address)

      token = insert(:token, contract_address: token_contract_address)

      transaction =
        :transaction
        |> insert()
        |> with_block()

      token_transfer =
        insert(
          :token_transfer,
          to_address: build(:address),
          transaction: transaction,
          token_contract_address: token_contract_address,
          token: token
        )

      another_transaction =
        :transaction
        |> insert()
        |> with_block()

      another_transfer =
        insert(
          :token_transfer,
          to_address: build(:address),
          transaction: another_transaction,
          token_contract_address: token_contract_address,
          token: token
        )

      insert(
        :token_transfer,
        to_address: build(:address),
        transaction: transaction,
        token_contract_address: build(:address),
        token: token
      )

      transfers_ids =
        token_contract_address.hash
        |> TokenTransfer.fetch_token_transfers_from_token_hash([])
        |> Enum.map(& &1.id)

      assert transfers_ids == [another_transfer.id, token_transfer.id]
    end

    test "when there isn't token transfers won't show anything" do
      token_contract_address = insert(:contract_address)

      insert(:token, contract_address: token_contract_address)

      transfers_ids =
        token_contract_address.hash
        |> TokenTransfer.fetch_token_transfers_from_token_hash([])
        |> Enum.map(& &1.id)

      assert transfers_ids == []
    end

    test "token transfers can be paginated" do
      token_contract_address = insert(:contract_address)

      transaction =
        :transaction
        |> insert()
        |> with_block()

      token = insert(:token)

      second_page =
        insert(
          :token_transfer,
          to_address: build(:address),
          transaction: transaction,
          token_contract_address: token_contract_address,
          token: token
        )

      first_page =
        insert(
          :token_transfer,
          to_address: build(:address),
          transaction: transaction,
          token_contract_address: token_contract_address,
          token: token
        )

      paging_options = %PagingOptions{key: first_page.inserted_at, page_size: 1}

      token_transfers_ids_paginated =
        TokenTransfer.fetch_token_transfers_from_token_hash(
          token_contract_address.hash,
          paging_options: paging_options
        )
        |> Enum.map(& &1.id)

      assert token_transfers_ids_paginated == [second_page.id]
    end
  end

  describe "count_token_transfers/0" do
    test "returns token transfers grouped by tokens" do
      token_contract_address = insert(:contract_address)
      token = insert(:token, contract_address: token_contract_address)

      transaction =
        :transaction
        |> insert()
        |> with_block()

      insert(
        :token_transfer,
        to_address: build(:address),
        transaction: transaction,
        token_contract_address: token_contract_address,
        token: token
      )

      insert(
        :token_transfer,
        to_address: build(:address),
        transaction: transaction,
        token_contract_address: token_contract_address,
        token: token
      )

      results = TokenTransfer.count_token_transfers()

      assert length(results) == 1
      assert List.first(results) == {token.contract_address_hash, 2}
    end
  end

  describe "address_to_unique_tokens/2" do
    test "returns list of unique tokens for a token contract" do
      token_contract_address = insert(:contract_address)
      token = insert(:token, contract_address: token_contract_address, type: "ERC-721")

      transaction =
        :transaction
        |> insert()
        |> with_block(insert(:block, number: 1))

      insert(
        :token_transfer,
        to_address: build(:address),
        transaction: transaction,
        token_contract_address: token_contract_address,
        token: token,
        token_id: 42
      )

      another_transaction =
        :transaction
        |> insert()
        |> with_block(insert(:block, number: 2))

      last_owner =
        insert(
          :token_transfer,
          to_address: build(:address),
          transaction: another_transaction,
          token_contract_address: token_contract_address,
          token: token,
          token_id: 42
        )

      results =
        token_contract_address.hash
        |> TokenTransfer.address_to_unique_tokens()
        |> Repo.all()

      assert Enum.map(results, & &1.token_id) == [last_owner.token_id]
      assert Enum.map(results, & &1.to_address_hash) == [last_owner.to_address_hash]
    end

    test "won't return tokens that aren't uniques" do
      token_contract_address = insert(:contract_address)
      token = insert(:token, contract_address: token_contract_address, type: "ERC-20")

      transaction =
        :transaction
        |> insert()
        |> with_block(insert(:block, number: 1))

      insert(
        :token_transfer,
        to_address: build(:address),
        transaction: transaction,
        token_contract_address: token_contract_address,
        token: token
      )

      results =
        token_contract_address.hash
        |> TokenTransfer.address_to_unique_tokens()
        |> Repo.all()

      assert results == []
    end
  end

  describe "where_address_fields_match/3" do
    # `Chain.address_to_transactions/2` composes this query on top of a query that already left joins the
    # transaction's `forks` association (to filter out reorg transactions), shifting the query's bindings to
    # `[transaction, fork]`. `where_address_fields_match/3` must join `token_transfers` relative to the
    # `transaction` binding regardless of what other bindings precede it.
    defp transaction_with_fork_join do
      Transaction
      |> join(:left, [transaction], fork in assoc(transaction, :forks))
    end

    test "with :from, matches transactions with a token transfer from the given address" do
      address = insert(:address)

      transaction =
        :transaction
        |> insert()
        |> with_block()

      insert(:token_transfer, from_address: address, transaction: transaction)

      other_transaction =
        :transaction
        |> insert()
        |> with_block()

      insert(:token_transfer, to_address: address, transaction: other_transaction)

      result =
        transaction_with_fork_join()
        |> TokenTransfer.where_address_fields_match(address.hash, :from)
        |> Repo.all()
        |> Enum.map(& &1.hash)
        |> Enum.uniq()

      assert result == [transaction.hash]
    end

    test "with :to, matches transactions with a token transfer to the given address" do
      address = insert(:address)

      transaction =
        :transaction
        |> insert()
        |> with_block()

      insert(:token_transfer, to_address: address, transaction: transaction)

      other_transaction =
        :transaction
        |> insert()
        |> with_block()

      insert(:token_transfer, from_address: address, transaction: other_transaction)

      result =
        transaction_with_fork_join()
        |> TokenTransfer.where_address_fields_match(address.hash, :to)
        |> Repo.all()
        |> Enum.map(& &1.hash)
        |> Enum.uniq()

      assert result == [transaction.hash]
    end

    test "with no direction, matches transactions with a token transfer to or from the given address" do
      address = insert(:address)

      from_transaction =
        :transaction
        |> insert()
        |> with_block()

      insert(:token_transfer, from_address: address, transaction: from_transaction)

      to_transaction =
        :transaction
        |> insert()
        |> with_block()

      insert(:token_transfer, to_address: address, transaction: to_transaction)

      unrelated_transaction =
        :transaction
        |> insert()
        |> with_block()

      insert(:token_transfer, transaction: unrelated_transaction)

      result =
        transaction_with_fork_join()
        |> TokenTransfer.where_address_fields_match(address.hash, nil)
        |> Repo.all()
        |> Enum.map(& &1.hash)
        |> Enum.uniq()
        |> Enum.sort()

      assert result == Enum.sort([from_transaction.hash, to_transaction.hash])
    end

    test "is compatible with a preceding filter on the transaction's forks association" do
      address = insert(:address)
      reorg_block = insert(:block, consensus: false)

      reorg_transaction =
        :transaction
        |> insert()
        |> with_block(reorg_block)

      insert(:transaction_fork, hash: reorg_transaction.hash, uncle_hash: reorg_block.hash)
      insert(:token_transfer, to_address: address, transaction: reorg_transaction)

      valid_transaction =
        :transaction
        |> insert()
        |> with_block()

      insert(:token_transfer, to_address: address, transaction: valid_transaction)

      result =
        Transaction
        |> join(:left, [transaction], fork in assoc(transaction, :forks))
        |> where([_transaction, fork], is_nil(fork.uncle_hash))
        |> TokenTransfer.where_address_fields_match(address.hash, :to)
        |> Repo.all()
        |> Enum.map(& &1.hash)

      assert result == [valid_transaction.hash]
    end
  end
end
