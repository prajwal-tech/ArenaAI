"use client";
import { create } from "zustand";

interface AuthStore {
  token: string | null;
  user: { id: string; username: string } | null;
  setAuth: (token: string, user: { id: string; username: string }) => void;
  logout: () => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  token: null,
  user: null,
  setAuth: (token, user) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("poiro_token", token);
      localStorage.setItem("poiro_user", JSON.stringify(user));
    }
    set({ token, user });
  },
  logout: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("poiro_token");
      localStorage.removeItem("poiro_user");
    }
    set({ token: null, user: null });
  },
  hydrate: () => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("poiro_token");
      const userStr = localStorage.getItem("poiro_user");
      if (token && userStr) {
        try {
          const user = JSON.parse(userStr);
          set({ token, user });
        } catch {}
      }
    }
  },
}));
