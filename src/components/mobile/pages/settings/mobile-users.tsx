"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, UserRound } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/components/shared/api-client";
import type { AdminUser } from "@/components/settings/users-manager";
import { formatRelative } from "@/lib/format";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileFab } from "@/components/mobile/ui/mobile-fab";
import { MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";

/** Same cache key as the desktop `UsersManager` so both views stay in sync. */
const USERS_KEY = ["admin-users"];

function RoleBadge({ role }: { role: AdminUser["role"] }) {
  return role === "ADMIN" ? (
    <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
      Admin
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      User
    </Badge>
  );
}

/**
 * Phone user management: tappable rows into a per-user action sheet plus a FAB
 * that opens the create form. Calls the same /api/admin/users endpoints as the
 * desktop `UsersManager`.
 */
export function MobileUsersSettingsPage({
  initialUsers,
  currentUserId,
}: {
  initialUsers: AdminUser[];
  currentUserId: string;
}) {
  const queryClient = useQueryClient();
  const { data: users = [] } = useQuery({
    queryKey: USERS_KEY,
    queryFn: () => apiFetch<AdminUser[]>("/api/admin/users"),
    initialData: initialUsers,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const target = users.find((u) => u.id === targetId) ?? null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: USERS_KEY });

  return (
    <>
      <MobilePageHeader title="Users" backHref="/settings" />
      <MobilePage>
        <MobileList>
          {users.map((u) => (
            <MobileListRow
              key={u.id}
              onClick={() => setTargetId(u.id)}
              leading={
                <span className="flex size-8 items-center justify-center rounded-full bg-muted">
                  <UserRound className="size-4" />
                </span>
              }
              title={
                <>
                  <span className="truncate">{u.username}</span>
                  {u.id === currentUserId && (
                    <span className="shrink-0 text-xs font-normal text-muted-foreground">(you)</span>
                  )}
                </>
              }
              subtitle={`${u.displayName ?? "No display name"} · created ${formatRelative(u.createdAt)}`}
              trailing={
                <>
                  <RoleBadge role={u.role} />
                  {u.disabled && (
                    <Badge
                      variant="outline"
                      className="border-destructive/40 bg-destructive/10 text-destructive"
                    >
                      Disabled
                    </Badge>
                  )}
                </>
              }
            />
          ))}
        </MobileList>
      </MobilePage>

      <MobileFab aria-label="Create user" onClick={() => setCreateOpen(true)}>
        <Plus />
      </MobileFab>

      <CreateUserSheet open={createOpen} onOpenChange={setCreateOpen} onSaved={invalidate} />
      <UserActionsSheet
        user={target}
        isSelf={target?.id === currentUserId}
        onClose={() => setTargetId(null)}
        onSaved={invalidate}
      />
    </>
  );
}

function CreateUserSheet({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AdminUser["role"]>("USER");

  const create = useMutation({
    mutationFn: () =>
      apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          displayName: displayName.trim() || undefined,
          role,
        }),
      }),
    onSuccess: () => {
      toast.success(`Created user ${username}`);
      onOpenChange(false);
      setUsername("");
      setPassword("");
      setDisplayName("");
      setRole("USER");
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create user"
      description="They can change their password and display name later."
    >
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="m-new-username">Username</Label>
          <Input
            id="m-new-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            maxLength={32}
            pattern="[a-zA-Z0-9._\-]+"
            title="Only letters, numbers, dots, dashes and underscores"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="m-new-user-password">Password</Label>
          <Input
            id="m-new-user-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="m-new-user-display">Display name (optional)</Label>
          <Input
            id="m-new-user-display"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={64}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="m-new-user-role">Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as AdminUser["role"])}>
            <SelectTrigger id="m-new-user-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USER">User — read and document</SelectItem>
              <SelectItem value="ADMIN">Admin — full control</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" className="w-full" disabled={create.isPending}>
          {create.isPending && <Loader2 className="animate-spin" />}
          {create.isPending ? "Creating…" : "Create user"}
        </Button>
      </form>
    </BottomSheet>
  );
}

function UserActionsSheet({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: AdminUser | null;
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AdminUser["role"]>("USER");
  const [newPassword, setNewPassword] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Sync form state when a new user is selected.
  if (user && loadedFor !== user.id) {
    setDisplayName(user.displayName ?? "");
    setRole(user.role);
    setNewPassword("");
    setLoadedFor(user.id);
  }

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/api/admin/users/${user!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ displayName: displayName.trim() || null, role }),
      }),
    onSuccess: () => {
      toast.success(`Updated ${user?.username}`);
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resetPassword = useMutation({
    mutationFn: () =>
      apiFetch(`/api/admin/users/${user!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ newPassword }),
      }),
    onSuccess: () => {
      toast.success(`Password reset for ${user?.username}. Their sessions were signed out.`);
      setNewPassword("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleDisabled = useMutation({
    mutationFn: () =>
      apiFetch(`/api/admin/users/${user!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ disabled: !user!.disabled }),
      }),
    onSuccess: () => {
      toast.success(user?.disabled ? `Enabled ${user.username}` : `Disabled ${user?.username}`);
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/admin/users/${user!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`Deleted ${user?.username}`);
      setConfirmDelete(false);
      onClose();
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <BottomSheet
        open={user !== null}
        onOpenChange={(open) => {
          if (!open) {
            onClose();
            setLoadedFor(null);
          }
        }}
        title={user?.username ?? ""}
        description={`${user?.role === "ADMIN" ? "Administrator" : "User"} · created ${
          user ? formatRelative(user.createdAt) : ""
        }`}
      >
        {user && (
          <div className="flex flex-col gap-5 pt-1">
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="m-edit-user-display">Display name</Label>
                <Input
                  id="m-edit-user-display"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={64}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="m-edit-user-role">Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as AdminUser["role"])}>
                  <SelectTrigger id="m-edit-user-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USER">User — read and document</SelectItem>
                    <SelectItem value="ADMIN">Admin — full control</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" />}
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
            </form>

            <form
              className="flex flex-col gap-2 border-t pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                resetPassword.mutate();
              }}
            >
              <Label htmlFor="m-reset-password">Reset password</Label>
              <Input
                id="m-reset-password"
                type="password"
                autoComplete="new-password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
              <p className="text-xs text-muted-foreground">
                All of their active sessions will be signed out.
              </p>
              <Button
                type="submit"
                variant="outline"
                className="w-full"
                disabled={resetPassword.isPending || newPassword.length < 8}
              >
                {resetPassword.isPending ? "Resetting…" : "Reset password"}
              </Button>
            </form>

            {!isSelf && (
              <div className="flex flex-col gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={toggleDisabled.isPending}
                  onClick={() => toggleDisabled.mutate()}
                >
                  {user.disabled ? "Enable account" : "Disable account"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete user
                </Button>
              </div>
            )}
          </div>
        )}
      </BottomSheet>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {user?.username}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the account, its sessions, and its API tokens. Audit history
              is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isPending && <Loader2 className="animate-spin" />}
              Delete user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
