"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CircleCheck, KeyRound, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { ListCard } from "@/components/inventory/list-card";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/components/shared/api-client";

export interface AdminUser {
  id: string;
  username: string;
  displayName: string | null;
  role: "ADMIN" | "USER";
  disabled: boolean;
  createdAt: string;
}

const USERS_KEY = ["admin-users"];

export function UsersManager({
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
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: USERS_KEY });
  }

  const toggleDisabled = useMutation({
    mutationFn: (u: AdminUser) =>
      apiFetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ disabled: !u.disabled }),
      }),
    onSuccess: (_data, u) => {
      toast.success(u.disabled ? `Enabled ${u.username}` : `Disabled ${u.username}`);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteUser = useMutation({
    mutationFn: (u: AdminUser) => apiFetch(`/api/admin/users/${u.id}`, { method: "DELETE" }),
    onSuccess: (_data, u) => {
      toast.success(`Deleted ${u.username}`);
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <PageHeader
        title="Users"
        description="Manage who can sign in and what they can do."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Create user
          </Button>
        }
      />

      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Display name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">
                  {u.username}
                  {u.id === currentUserId && (
                    <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                  )}
                </TableCell>
                <TableCell>{u.displayName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  {u.role === "ADMIN" ? (
                    <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                      Admin
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      User
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {u.disabled ? (
                    <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                      Disabled
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
                      Active
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{formatRelative(u.createdAt)}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${u.username}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditTarget(u)}>
                        <Pencil className="size-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setResetTarget(u)}>
                        <KeyRound className="size-4" /> Reset password
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => toggleDisabled.mutate(u)}>
                        {u.disabled ? (
                          <>
                            <CircleCheck className="size-4" /> Enable
                          </>
                        ) : (
                          <>
                            <Ban className="size-4" /> Disable
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(u)}>
                        <Trash2 className="size-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ListCard>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={invalidate} />
      <EditUserDialog user={editTarget} onOpenChange={() => setEditTarget(null)} onSaved={invalidate} />
      <ResetPasswordDialog user={resetTarget} onOpenChange={() => setResetTarget(null)} />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.username}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the account, its sessions, and its API tokens. Audit history is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteUser.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteUser.mutate(deleteTarget);
              }}
            >
              {deleteUser.isPending && <Loader2 className="animate-spin" />}
              Delete user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateUserDialog({
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
  const [role, setRole] = useState<"ADMIN" | "USER">("USER");

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>They can change their password and display name later.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-username">Username</Label>
              <Input
                id="new-username"
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
              <Label htmlFor="new-user-password">Password</Label>
              <Input
                id="new-user-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-user-display">Display name (optional)</Label>
              <Input
                id="new-user-display"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={64}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-user-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as "ADMIN" | "USER")}>
                <SelectTrigger id="new-user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USER">User — read and document</SelectItem>
                  <SelectItem value="ADMIN">Admin — full control</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  onOpenChange,
  onSaved,
}: {
  user: AdminUser | null;
  onOpenChange: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"ADMIN" | "USER">("USER");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Sync form state when a new user is selected.
  if (user && loadedFor !== user.id) {
    setDisplayName(user.displayName ?? "");
    setRole(user.role);
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
      onOpenChange();
      setLoadedFor(null);
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open) {
          onOpenChange();
          setLoadedFor(null);
        }
      }}
    >
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit {user?.username}</DialogTitle>
            <DialogDescription>Change the display name or role.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-user-display">Display name</Label>
              <Input
                id="edit-user-display"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={64}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-user-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as "ADMIN" | "USER")}>
                <SelectTrigger id="edit-user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USER">User — read and document</SelectItem>
                  <SelectItem value="ADMIN">Admin — full control</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onOpenChange}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: AdminUser | null;
  onOpenChange: () => void;
}) {
  const [newPassword, setNewPassword] = useState("");

  const reset = useMutation({
    mutationFn: () =>
      apiFetch(`/api/admin/users/${user!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ newPassword }),
      }),
    onSuccess: () => {
      toast.success(`Password reset for ${user?.username}. Their sessions were signed out.`);
      onOpenChange();
      setNewPassword("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onOpenChange()}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            reset.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Reset password for {user?.username}</DialogTitle>
            <DialogDescription>All of their active sessions will be signed out.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="reset-password">New password</Label>
              <Input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onOpenChange}>
              Cancel
            </Button>
            <Button type="submit" disabled={reset.isPending}>
              {reset.isPending ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
