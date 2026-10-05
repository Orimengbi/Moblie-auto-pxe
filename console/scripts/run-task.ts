import { runTask } from "../lib/remote.ts";

const id = process.argv[2];
if (!id) {
  console.error("缺少任务 id");
  process.exit(1);
}

try {
  const task = await runTask(id);
  const ok = task.targets.filter((target) => target.status === "ok").length;
  console.log(`任务 ${id} 结束：${ok}/${task.targets.length} 台成功`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
