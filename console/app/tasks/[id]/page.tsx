import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { TaskDetail } from "@/components/task-detail";
import { listAssets } from "@/lib/assets";
import { getProject, getTask } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) notFound();
  const project = task.projectId ? getProject(task.projectId) : null;
  const wanted = new Set(task.targets.map((target) => target.serverId));
  const tags = Object.fromEntries(listAssets().filter((asset) => wanted.has(asset.id)).map((asset) => [asset.id, asset.tag]));
  return (
    <div>
      <PageHeader title={task.name} description="每台机器的执行结果。点一行看完整输出。" />
      <TaskDetail initial={task} project={project ? { id: project.id, name: project.name } : null} tags={tags} />
    </div>
  );
}
