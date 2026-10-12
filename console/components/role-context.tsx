"use client";

import { createContext, useContext } from "react";
import type { Permission } from "@/lib/roles";

const PermissionContext = createContext<readonly Permission[]>([]);

/** 当前登录的人能用的权限点（用限权密钥登录时是限过的），给页面上的按钮判断能不能点。接口那边另有检查。 */
export function RoleProvider({ permissions, children }: { permissions: readonly Permission[]; children: React.ReactNode }) {
  return <PermissionContext.Provider value={permissions}>{children}</PermissionContext.Provider>;
}

export function useCan(permission: Permission): boolean {
  return useContext(PermissionContext).includes(permission);
}
