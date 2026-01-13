"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import type { Notification } from "@/lib/types";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/firestore";
import { useAuth } from "@/contexts/AuthContext";

type NotificationsContextValue = {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    const notificationsQuery = query(
      collection(db, COLLECTIONS.NOTIFICATIONS),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      notificationsQuery,
      (snapshot) => {
        setNotifications(
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<Notification, "id">),
          }))
        );
        setLoading(false);
      },
      () => {
        setNotifications([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [authLoading, user]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications]
  );

  const markAsRead = useCallback(async (id: string) => {
    const ref = doc(db, COLLECTIONS.NOTIFICATIONS, id);
    await updateDoc(ref, { read: true });
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!user) return;
    const batch = writeBatch(db);
    notifications
      .filter((notification) => !notification.read)
      .forEach((notification) => {
        const ref = doc(db, COLLECTIONS.NOTIFICATIONS, notification.id);
        batch.update(ref, { read: true });
      });
    await batch.commit();
  }, [notifications, user]);

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      markAsRead,
      markAllAsRead,
    }),
    [notifications, unreadCount, loading, markAsRead, markAllAsRead]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationsProvider");
  }
  return context;
}
