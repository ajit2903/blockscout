# SPDX-License-Identifier: LicenseRef-Blockscout
defmodule BlockScoutWeb.Admin.SessionControllerTest do
  use BlockScoutWeb.ConnCase

  alias BlockScoutWeb.Admin.OneTimeLogin

  setup %{conn: conn} do
    conn =
      conn
      |> bypass_through()
      |> get("/")

    {:ok, conn: conn}
  end

  setup do
    original_login_id = Application.get_env(:block_scout_web, :admin_one_time_login_id)
    original_password = Application.get_env(:block_scout_web, :admin_one_time_password)

    on_exit(fn ->
      if is_nil(original_login_id) do
        Application.delete_env(:block_scout_web, :admin_one_time_login_id)
      else
        Application.put_env(:block_scout_web, :admin_one_time_login_id, original_login_id)
      end

      if is_nil(original_password) do
        Application.delete_env(:block_scout_web, :admin_one_time_password)
      else
        Application.put_env(:block_scout_web, :admin_one_time_password, original_password)
      end
    end)
  end

  describe "new/2" do
    test "redirects to setup page if not configured", %{conn: conn} do
      result = get(conn, AdminRoutes.session_path(conn, :new))
      assert redirected_to(result) == AdminRoutes.setup_path(conn, :configure)
    end

    test "shows the admin login page", %{conn: conn} do
      insert(:administrator)
      result = get(conn, AdminRoutes.session_path(conn, :new))
      assert html_response(result, 200) =~ "administrator_login"
    end
  end

  describe "create/2" do
    test "redirects to setup page if not configured", %{conn: conn} do
      result = post(conn, AdminRoutes.session_path(conn, :create), %{})
      assert redirected_to(result) == AdminRoutes.setup_path(conn, :configure)
    end

    test "redirects to dashboard on successful admin login", %{conn: conn} do
      admin = insert(:administrator)

      params = %{
        "authenticate" => %{
          username: admin.user.username,
          password: "password"
        }
      }

      result = post(conn, AdminRoutes.session_path(conn, :create), params)
      assert redirected_to(result) == AdminRoutes.dashboard_path(conn, :index)
    end

    test "redirects to dashboard on successful admin email login", %{conn: conn} do
      admin = insert(:administrator)

      params = %{
        "authenticate" => %{
          username: Enum.at(admin.user.contacts, 0).email,
          password: "password"
        }
      }

      result = post(conn, AdminRoutes.session_path(conn, :create), params)
      assert redirected_to(result) == AdminRoutes.dashboard_path(conn, :index)
    end

    test "redirects to dashboard on successful one-time admin login", %{conn: conn} do
      insert(:administrator)
      Application.put_env(:block_scout_web, :admin_one_time_login_id, "one-time-admin")
      Application.put_env(:block_scout_web, :admin_one_time_password, "one-time-password")

      params = %{
        "authenticate" => %{
          username: "one-time-admin",
          password: "one-time-password"
        }
      }

      result = post(conn, AdminRoutes.session_path(conn, :create), params)
      assert redirected_to(result) == AdminRoutes.dashboard_path(conn, :index)
      assert get_session(result, OneTimeLogin.session_key())
    end

    test "reshows form if params are invalid", %{conn: conn} do
      insert(:administrator)
      params = %{"authenticate" => %{}}

      result = post(conn, AdminRoutes.session_path(conn, :create), params)
      assert html_response(result, 200) =~ "administrator_login"
    end

    test "reshows form if credentials are invalid", %{conn: conn} do
      admin = insert(:administrator)

      params = %{
        "authenticate" => %{
          username: admin.user.username,
          password: "badpassword"
        }
      }

      result = post(conn, AdminRoutes.session_path(conn, :create), params)
      assert html_response(result, 200) =~ "administrator_login"
    end

    test "reshows form if user is not an admin", %{conn: conn} do
      insert(:administrator)
      user = insert(:user)

      params = %{
        "authenticate" => %{
          username: user.username,
          password: "password"
        }
      }

      result = post(conn, AdminRoutes.session_path(conn, :create), params)
      assert html_response(result, 200) =~ "administrator_login"
    end
  end
end
