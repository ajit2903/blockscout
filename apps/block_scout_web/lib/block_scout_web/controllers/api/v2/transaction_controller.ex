# SPDX-License-Identifier: LicenseRef-Blockscout
defmodule BlockScoutWeb.API.V2.TransactionController do
  use BlockScoutWeb, :controller

  use Utils.CompileTimeEnvHelper,
    chain_identity: [:explorer, :chain_identity]

  use OpenApiSpex.ControllerSpecs

  import BlockScoutWeb.Account.AuthController, only: [current_user: 1]

  import BlockScoutWeb.Chain,
    only: [
      next_page_params: 3,
      next_page_params: 4,
      next_page_params: 5,
      put_key_value_to_paging_options: 3,
      token_transfers_next_page_params: 3,
      paging_options: 1,
      split_list_by_page: 1,
      fetch_scam_token_toggle: 2,
      transaction_to_internal_transactions: 2
    ]

  import BlockScoutWeb.PagingHelper,
    only: [
      paging_options: 2,
      filter_options: 2,
      method_filter_options: 1,
      token_transfers_types_options: 1,
      type_filter_options: 1
    ]

  import Explorer.MicroserviceInterfaces.BENS,
    only: [
      maybe_preload_ens: 1,
      maybe_preload_ens_for_token_transfers: 1,
      maybe_preload_ens_for_transactions: 1,
      maybe_preload_ens_to_transaction: 1
    ]

  import Explorer.MicroserviceInterfaces.Metadata,
    only: [maybe_preload_metadata: 1, maybe_preload_metadata_to_transaction: 1]

  import Explorer.Chain.Address.Reputation, only: [reputation_association: 0]

  import Ecto.Query,
    only: [
      preload: 2
    ]

  require Logger

  alias BlockScoutWeb.AccessHelper
  alias BlockScoutWeb.API.V2.{BlobView, Ethereum.DepositController, Ethereum.DepositView}
  alias BlockScoutWeb.MicroserviceInterfaces.TransactionInterpretation, as: TransactionInterpretationService
  alias BlockScoutWeb.Models.TransactionStateHelper
  alias BlockScoutWeb.Schemas.API.V2.ErrorResponses.{ForbiddenResponse, NotFoundResponse}
  alias Explorer.Account.WatchlistAddress
  alias Explorer.{Chain, PagingOptions, Repo}
  alias Explorer.Chain.Arbitrum.Reader.API.Settlement, as: ArbitrumSettlementReader
  alias Explorer.Chain.Beacon.Deposit, as: BeaconDeposit
  alias Explorer.Chain.Beacon.Reader, as: BeaconReader
  alias Explorer.Chain.Cache.Counters.{NewPendingTransactionsCount, Transactions24hCount}
  alias Explorer.Chain.{FheOperation, Hash, Transaction}
  alias Explorer.Chain.Optimism.TransactionBatch, as: OptimismTransactionBatch
  alias Explorer.Chain.Scroll.Reader, as: ScrollReader
  alias Explorer.Chain.Token.Instance
  alias Explorer.Chain.ZkSync.Reader, as: ZkSyncReader
  alias Indexer.Fetcher.OnDemand.FirstTrace, as: FirstTraceOnDemand
  alias Indexer.Fetcher.OnDemand.NeonSolanaTransactions, as: NeonSolanaTransactions

  action_fallback(BlockScoutWeb.API.V2.FallbackController)

  plug(OpenApiSpex.Plug.CastAndValidate, json_render_error_v2: true)

  tags(["transactions"])

  case @chain_identity do
    {:ethereum, nil} ->
      @chain_type_transaction_necessity_by_association %{
        :beacon_blob_transaction => :optional
      }

    {:optimism, :celo} ->
      @chain_type_transaction_necessity_by_association %{
        [gas_token: reputation_association()] => :optional
      }

    {:eden, nil} ->
      @chain_type_transaction_necessity_by_association %{
        [fee_payer_address: [:scam_badge, :names, :smart_contract, proxy_implementations_association()]] => :optional
      }

    _ ->
      @chain_type_transaction_necessity_by_association %{}
  end

  # TODO might be redundant to preload blob fields in some of the endpoints
  @transaction_necessity_by_association %{
                                          :block => :optional,
                                          [
                                            created_contract_address: [
                                              :scam_badge,
                                              :names,
                                              :token,
                                              :smart_contract,
                                              proxy_implementations_association()
                                            ]
                                          ] => :optional,
                                          [
                                            from_address: [
                                              :scam_badge,
                                              :names,
                                              :smart_contract,
                                              proxy_implementations_association()
                                            ]
                                          ] => :optional,
                                          [
                                            to_address: [
                                              :scam_badge,
                                              :names,
                                              :smart_contract,
                                              proxy_implementations_association()
                                            ]
                                          ] => :optional
                                        }
                                        |> Map.merge(@chain_type_transaction_necessity_by_association)

  @token_transfers_necessity_by_association %{
    [from_address: [:scam_badge, :names, :smart_contract, proxy_implementations_association()]] => :optional,
    [to_address: [:scam_badge, :names, :smart_contract, proxy_implementations_association()]] => :optional,
    [token: reputation_association()] => :optional
  }

  @token_transfers_in_transaction_necessity_by_association %{
    [from_address: [:scam_badge, :names, :smart_contract, proxy_implementations_association()]] => :optional,
    [to_address: [:scam_badge, :names, :smart_contract, proxy_implementations_association()]] => :optional,
    [token: reputation_association()] => :optional
  }

  @internal_transaction_address_preloads [
    address_preloads: [
      created_contract_address: [:scam_badge, :names, :smart_contract, proxy_implementations_association()],
      from_address: [:scam_badge, :names, :smart_contract, proxy_implementations_association()],
      to_address: [:scam_badge, :names, :smart_contract, proxy_implementations_association()]
    ]
  ]

  @api_true [api?: true]

  operation :transaction,
    summary: "Retrieve detailed information about a specific transaction",
    description: "Retrieves detailed information for a specific transaction identified by its hash.",
    parameters: [transaction_hash_param() | base_params()],
    responses: [
      ok: {"Detailed information about the specified transaction.", "application/json", Schemas.Transaction.Response},
      not_found: NotFoundResponse.response(),
      unprocessable_entity: JsonErrorResponse.response()
    ]

  @doc """
    Function to handle GET requests to `/api/v2/transactions/:transaction_hash_param` endpoint.
  """
  @spec transaction(Plug.Conn.t(), map()) :: Plug.Conn.t() | {atom(), any()}
  def transaction(conn, %{transaction_hash_param: transaction_hash_string} = params) do
    necessity_by_association_with_actions =
      @transaction_necessity_by_association
      |> Map.put(:signed_authorizations, :optional)

    necessity_by_association =
      case Application.get_env(:explorer, :chain_type) do
        :zksync ->
          necessity_by_association_with_actions
          |> Map.put(:zksync_batch, :optional)
          |> Map.put(:zksync_commit_transaction, :optional)
          |> Map.put(:zksync_prove_transaction, :optional)
          |> Map.put(:zksync_execute_transaction, :optional)

        :arbitrum ->
          necessity_by_association_with_actions
          |> Map.put(:arbitrum_batch, :optional)
          |> Map.put(:arbitrum_commitment_transaction, :optional)
          |> Map.put(:arbitrum_confirmation_transaction, :optional)
          |> Map.put(:arbitrum_message_to_l2, :optional)
          |> Map.put(:arbitrum_message_from_l2, :optional)

        :suave ->
          necessity_by_association_with_actions
          |> Map.put(:logs, :optional)
          |> Map.put([execution_node: :names], :optional)
          |> Map.put([wrapped_to_address: :names], :optional)

        _ ->
          necessity_by_association_with_actions
      end

    options =
      [necessity_by_association: necessity_by_association]
      |> Keyword.merge(@api_true)

    with {:ok, transaction, _transaction_hash} <- validate_transaction(transaction_hash_string, params, options),
         preloaded <-
           Chain.preload_token_transfers(
             transaction,
             @token_transfers_in_transaction_necessity_by_association,
             @api_true |> fetch_scam_token_toggle(conn)
           ) do
      conn
      |> put_status(200)
      |> render(:transaction, %{
        transaction:
          preloaded
          |> Instance.preload_nft(@api_true)
          |> maybe_preload_ens_to_transaction()
          |> maybe_preload_metadata_to_transaction()
      })
    end
  end

  operation :transactions,
    summary: "List blockchain transactions with filtering options for status, type, and method",
    description: "Retrieves a paginated list of transactions with optional filtering by status, type, and method.",
    parameters:
      base_params() ++
        [transaction_filter_param(), transaction_type_param()] ++
        define_paging_params(["block_number", "index", "items_count", "hash", "inserted_at"]),
    responses: [
      ok:
        {"List of transactions with pagination information.", "application/json",
         paginated_response(
           items: Schemas.Transaction.Response,
           next_page_params_example: %{
             "block_number" => 23_532_302,
             "index" => 375,
             "items_count" => 50
           }
         )},
      unprocessable_entity: JsonErrorResponse.response()
    ]

  @doc """
    Function to handle GET requests to `/api/v2/transactions` endpoint.
  """
  @spec transactions(Plug.Conn.t(), map()) :: Plug.Conn.t()
  def transactions(conn, params) do
    filter_options = filter_options(params, :validated)

    full_options =
      [
        necessity_by_association: transactions_necessity_by_association()
      ]
      |> Keyword.merge(paging_options(params, filter_options))
      |> Keyword.merge(method_filter_options(params))
      |> Keyword.merge(type_filter_options(params))
      |> Keyword.merge(@api_true)

    transactions_plus_one = Chain.recent_transactions(full_options, filter_options)

    {transactions, next_page} = split_list_by_page(transactions_plus_one)

    next_page_params = next_page |> next_page_params(transactions, params)

    conn
    |> put_status(200)
    |> render(:transactions, %{
      transactions: transactions |> maybe_preload_ens_for_transactions() |> maybe_preload_metadata(),
      next_page_params: next_page_params
    })
  end

  defp transactions_necessity_by_association do
    %{
      :block => :optional,
      [
        created_contract_address: [
          :scam_badge,
          :names,
          :token,
          proxy_implementations_association()
        ]
      ] => :optional,
      [
        from_address: [
          :scam_badge,
          :names,
          proxy_implementations_association()
        ]
      ] => :optional,
      [
        to_address: [
          :scam_badge,
          :names,
          proxy_implementations_association()
        ]
      ] => :optional
    }
    |> Map.merge(@chain_type_transaction_necessity_by_association)
  end

  operation :zksync_batch,
    summary: "List L2 transactions in a ZkSync batch",
    description: "Retrieves L2 transactions bound to a specific ZkSync batch number.",
    parameters:
      base_params() ++
        [batch_number_param()] ++ define_paging_params(["block_number", "index", "items_count"]),
    responses: [
      ok:
        {"ZkSync batch transactions.", "application/json",
         paginated_response(
           items: Schemas.Transaction.Response,
           next_page_params_example: %{
             "block_number" => 65_361_291,
             "index" => 1,
             "items_count" => 50
           }
         )},
      unprocessable_entity: JsonErrorResponse.response()
    ]

  @doc """
    Function to handle GET requests to `/api/v2/transactions/zksync-batch/:batch_number` endpoint.
    It renders the list of L2 transactions bound to the specified batch.
  """
  @spec zksync_batch(Plug.Conn.t(), map()) :: Plug.Conn.t()
  def zksync_batch(conn, params) do
    handle_batch_transactions(conn, params, &ZkSyncReader.batch_transactions/2)
  end

  operation :arbitrum_batch,
    summary: "List L2 transactions in an Arbitrum batch",
    description: "Retrieves L2 transactions bound to a specific Arbitrum batch number.",
    parameters:
      base_params() ++
        [batch_number_param()] ++ define_paging_params(["block_number", "index", "items_count"]),
    responses: [
      ok:
        {"Arbitrum batch transactions.", "application/json",
         paginated_response(
           items: Schemas.Transaction.Response,
           next_page_params_example: %{
             "block_number" => 391_483_842,
             "index" => 0,
             "items_count" => 50
           }
         )},
      unprocessable_entity: JsonErrorResponse.response()
    ]

  @doc """
    Function to handle GET requests to `/api/v2/transactions/arbitrum-batch/:batch_number` endpoint.
    It renders the list of L2 transactions bound to the specified batch.
  """
  @spec arbitrum_batch(Plug.Conn.t(), map()) :: Plug.Conn.t()
  def arbitrum_batch(conn, params) do
    handle_batch_transactions(conn, params, &ArbitrumSettlementReader.batch_transactions/2)
  end

  # ... rest of the file unchanged ...
end
