import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { KeyRound } from "lucide-react";

import { Button, Input } from "@/components/ui";
import { clearSession, getUser, saveSession, type SessionUser } from "@/lib/auth";

const msg = (e: any) => e?.response?.data?.message || e?.message || "Something went wrong.";

const rules = (pw: string, email: string) => [
    { ok: pw.length >= 8, text: "At least 8 characters" },
    { ok: /[A-Za-z]/.test(pw) && /\d/.test(pw), text: "Letters and at least one number" },
    { ok: !(email.split("@")[0]!.length >= 4 && pw.toLowerCase().includes(email.split("@")[0]!.toLowerCase())), text: "Does not contain your email name" },
];

/** The first thing a person with a temporary password sees. Nothing else opens until they choose their own. */
export default function ChangePasswordPage() {
    const navigate = useNavigate();
    const user = getUser();
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [again, setAgain] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const checks = rules(next, user?.email ?? "");
    const ready = !!current && checks.every((c) => c.ok) && next === again && next !== current;

    const save = async () => {
        setBusy(true); setError(null);
        try {
            const r = (await axios.post("/api/auth/change-password", { currentPassword: current, newPassword: next })).data.response as { token: string; user: SessionUser };
            saveSession(r.token, r.user, false);
            navigate("/", { replace: true });
        } catch (e) { setError(msg(e)); } finally { setBusy(false); }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-ink-50 p-4 dark:bg-ink-950">
            <form className="flex w-full max-w-sm flex-col gap-4 border border-ink-200 bg-white p-8 dark:border-white/10 dark:bg-ink-900" onSubmit={(e) => { e.preventDefault(); if (ready) void save(); }}>
                <div className="flex items-center gap-2"><KeyRound className="text-brand-600" size={22} /><span className="text-lg font-extrabold tracking-wide">CHOOSE YOUR PASSWORD</span></div>
                <p className="text-sm text-ink-500">You signed in with a temporary password. Choose your own to continue{user ? `, ${user.name}` : ""}.</p>
                <Input type="password" label="Temporary password" labelPlacement="outside" value={current} onValueChange={setCurrent} autoComplete="current-password" isRequired />
                <Input type="password" label="New password" labelPlacement="outside" value={next} onValueChange={setNext} autoComplete="new-password" isRequired />
                <ul className="-mt-2 flex flex-col gap-1 text-xs">
                    {checks.map((c) => <li key={c.text} className={next ? (c.ok ? "text-emerald-600" : "text-rose-600") : "text-ink-500"}>{next && c.ok ? "✓" : "•"} {c.text}</li>)}
                </ul>
                <Input type="password" label="New password again" labelPlacement="outside" value={again} onValueChange={setAgain} autoComplete="new-password" isRequired
                    isInvalid={!!again && again !== next} errorMessage="The two passwords are different" />
                {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
                <Button type="submit" color="primary" isLoading={busy} isDisabled={!ready}>Save and continue</Button>
                <Button variant="light" onPress={() => { clearSession(); navigate("/login", { replace: true }); }}>Sign out</Button>
            </form>
        </div>
    );
}
