import { PageHeader } from "@/components/page-header";
import { TaskList } from "@/components/task-list";

export const dynamic = "force-dynamic";

export default function TasksPage() {
  return (
    <div>
      <PageHeader title="任务中心" description="所有批量任务：执行脚本、采集硬件、BMC 操作、固件升级等。结束的任务归档后就不在右上角的任务列表里显示，这里照样能查；结束满 1 小时自动归档。" />
      <TaskList />
    </div>
  );
}
