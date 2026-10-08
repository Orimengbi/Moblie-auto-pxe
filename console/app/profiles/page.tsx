import { redirect } from "next/navigation";

/** 旧地址：IPMI 和安装设置早就放进装机批次里了，直接跳过去。 */
export default function OldPage() {
  redirect("/projects");
}
