"use client";

import { createContext, useContext } from "react";
import { atLeast, normalizeRole, type Role } from "@/lib/roles";

const RoleContext = createContext<Role>("viewer");

/** 当前登录的角色（用限权密钥登录时是限过的），给页面上的按钮判断能不能点。接口那边另有检查。 */
export function RoleProvider({ role, children }: { role: string; children: React.ReactNode }) {
  return <RoleContext.Provider value={normalizeRole(role)}>{children}</RoleContext.Provider>;
}

export function useRole(): Role {
  return useContext(RoleContext);
}

export function useCan(min: Role): boolean {
  return atLeast(useRole(), min);
}
