# SPDX-License-Identifier: LicenseRef-Blockscout
defmodule BlockScoutWeb.Admin.OneTimeLogin do
  @moduledoc false

  import Plug.Conn, only: [get_session: 2]

  @session_key :admin_one_time_authenticated

  def session_key, do: @session_key

  def authenticated_session?(conn) do
    get_session(conn, @session_key) == true
  end

  def valid_credentials?(params) when is_map(params) do
    with {configured_login_id, configured_password} when configured_login_id != "" and configured_password != "" <-
           configured_credentials(),
         login_id when is_binary(login_id) <- Map.get(params, "username") || Map.get(params, :username),
         password when is_binary(password) <- Map.get(params, "password") || Map.get(params, :password) do
      secure_compare(login_id, configured_login_id) and secure_compare(password, configured_password)
    else
      _ -> false
    end
  end

  defp configured_credentials do
    {
      Application.get_env(:block_scout_web, :admin_one_time_login_id) || "",
      Application.get_env(:block_scout_web, :admin_one_time_password) || ""
    }
  end

  defp secure_compare(left, right) when byte_size(left) == byte_size(right) do
    Plug.Crypto.secure_compare(left, right)
  end

  defp secure_compare(_, _), do: false
end
