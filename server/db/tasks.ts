import { getDb } from "./firestore.js";

export interface Task {
  id: string;
  licenseKey: string;
  domain: string;
  prompt: string;
  source: "api" | "mcp";
  status: "completed" | "failed";
  result?: string;
  error?: string;
  creditsCost: number;
  createdAt: number;
}

const collection = () => getDb().collection("tasks");

export async function recordTask(params: {
  licenseKey: string;
  domain: string;
  prompt: string;
  source: "api" | "mcp";
  status: "completed" | "failed";
  result?: string;
  error?: string;
  creditsCost: number;
}): Promise<Task> {
  const ref = collection().doc();
  const task: Task = { id: ref.id, createdAt: Date.now(), ...params };
  await ref.set(task);
  return task;
}

export async function listTasks(licenseKey: string, limit = 20): Promise<Task[]> {
  const snap = await collection()
    .where("licenseKey", "==", licenseKey)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as Task);
}

/** Returns null if the task doesn't exist OR belongs to a different account — callers should treat both as "not found". */
export async function getTask(taskId: string, licenseKey: string): Promise<Task | null> {
  const snap = await collection().doc(taskId).get();
  if (!snap.exists) return null;
  const task = snap.data() as Task;
  return task.licenseKey === licenseKey ? task : null;
}
