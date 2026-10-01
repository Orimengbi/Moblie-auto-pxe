import { DiagManager } from "@/components/diag-manager";
import { PageHeader } from "@/components/page-header";
import { diagReady, getState, listScripts } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function DiagPage() {
  const state = getState();
  return (
    <div>
      <PageHeader
        title="诊断与验机"
        description="验机和安装是两条启动入口。验机系统放在内存里，只读查看硬件，跑你上传的脚本，再把结果回传到这台小主机。它不会格式化，也不会挂载本地硬盘。"
      />
      <DiagManager ready={diagReady()} builtin={state.builtinDiag} scripts={listScripts()} />
    </div>
  );
}
