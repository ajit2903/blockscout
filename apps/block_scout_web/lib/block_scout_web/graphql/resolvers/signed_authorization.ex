defmodule BlockScoutWeb.GraphQL.Resolvers.SignedAuthorization do
  @moduledoc false

  alias Explorer.Chain.Transaction
  alias Explorer.{GraphQL, Repo}

  def get_by(%Transaction{} = transaction, _, _) do
    signed_authorizations =
      transaction
      |> GraphQL.transaction_to_signed_authorizations_query()
      |> Repo.all()

    {:ok, signed_authorizations}
  end
end