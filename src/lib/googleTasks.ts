const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1';

export async function fetchTaskLists(accessToken: string) {
  const res = await fetch(`${TASKS_API_BASE}/users/@me/lists`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to fetch task lists');
  const data = await res.json();
  return data.items || [];
}

export async function fetchTasks(accessToken: string, listId: string) {
  const res = await fetch(`${TASKS_API_BASE}/lists/${listId}/tasks?showCompleted=true&showHidden=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to fetch tasks');
  const data = await res.json();
  return data.items || [];
}

export async function createTask(accessToken: string, listId: string, title: string, notes?: string, due?: string) {
  const res = await fetch(`${TASKS_API_BASE}/lists/${listId}/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, notes, due }),
  });
  if (!res.ok) throw new Error('Failed to create task');
  return res.json();
}

export async function updateTask(accessToken: string, listId: string, taskId: string, updates: any) {
  const res = await fetch(`${TASKS_API_BASE}/lists/${listId}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update task');
  return res.json();
}

export async function deleteTask(accessToken: string, listId: string, taskId: string) {
  const res = await fetch(`${TASKS_API_BASE}/lists/${listId}/tasks/${taskId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to delete task');
  return true;
}
