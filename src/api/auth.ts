import { call } from "./_client";

export type SetupInitResp = {
  qr_svg: string;
  setup_token: string;
  otpauth_url?: string;
};

export function setupInit(): Promise<SetupInitResp> {
  return call<SetupInitResp>("/api/auth/setup-init", { method: "POST" });
}

export function setupVerify(setup_token: string, code: string): Promise<{ bound: true }> {
  return call<{ bound: true }>("/api/auth/setup-verify", {
    method: "POST",
    body: { setup_token, code },
  });
}

export function login(code: string): Promise<{ authed: true }> {
  return call<{ authed: true }>("/api/auth/login", {
    method: "POST",
    body: { code },
  });
}
