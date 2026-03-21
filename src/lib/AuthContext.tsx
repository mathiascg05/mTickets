"use client";

import { createContext, useContext } from "react";

interface AuthContextValue {
  email: string;
  isSuperAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  email: "",
  isSuperAdmin: false,
});

export const AuthProvider = AuthContext.Provider;

export function useAuthContext() {
  return useContext(AuthContext);
}
