import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

export interface TrashItem {
  id: string; // The original ID of the item
  type: 'event' | 'journal' | 'memo' | 'schedule'; // Type of item
  deletedAt: number; // Timestamp of deletion
  originalDateStr?: string; // The date string it belonged to (e.g., '2026-09-07')
  fId?: string; // The group/folder ID it belonged to
  content?: string; // The content or text of the item
  data: any; // The full original data object to restore
}

/**
 * Move an item to the trash collection in Firestore.
 */
export async function moveToTrash(item: Omit<TrashItem, 'deletedAt'>) {
  const user = auth.currentUser;
  if (!user) return;

  const trashId = `${Date.now()}_${item.id}`;
  const trashRef = doc(db, 'users', user.uid, 'trash', trashId);

  const trashData: TrashItem = {
    ...item,
    id: trashId, // Store under a unique trash ID to avoid conflicts if same item is deleted multiple times
    deletedAt: Date.now(),
  };

  await setDoc(trashRef, trashData);
}

/**
 * Permanently delete an item from the trash.
 */
export async function deleteFromTrash(trashId: string) {
  const user = auth.currentUser;
  if (!user) return;

  const trashRef = doc(db, 'users', user.uid, 'trash', trashId);
  await deleteDoc(trashRef);
}

/**
 * Restore an item from the trash to its original location.
 * Note: The actual restoration logic to update the specific document (events, journals, etc.)
 * is usually handled in the respective hook (like useDayData) since it requires updating arrays.
 * This helper only deletes it from the trash collection after restoration.
 */
export async function completeRestoreFromTrash(trashId: string) {
  await deleteFromTrash(trashId);
}
