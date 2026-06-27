def test_register_login_and_me(client):
    register_response = client.post(
        "/api/v1/auth/register",
        json={
            "organization_name": "Acme SaaS",
            "admin_email": "owner@acme.example.com",
            "password": "secure-password",
            "admin_full_name": "Acme Owner",
        },
    )
    assert register_response.status_code == 201, register_response.text
    register_payload = register_response.json()
    assert register_payload["access_token"]
    assert register_payload["user"]["organization"]["public_id"].startswith("company_")

    login_response = client.post(
        "/api/v1/auth/login",
        json={"email": "owner@acme.example.com", "password": "secure-password"},
    )
    assert login_response.status_code == 200, login_response.text
    token = login_response.json()["access_token"]

    me_response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_response.status_code == 200, me_response.text
    assert me_response.json()["email"] == "owner@acme.example.com"
