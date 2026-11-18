import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { KeyRound } from "lucide-react";

import { Button, Input } from "@/components/ui";

const msg = (e: any) => e?.response?.data?.message || e?.message || "Something went wrong.";

const rules = (pw: string) => [
    { ok: pw.length >= 8, text: "At least 8 characters" },
    { ok: /[A-Za-z]/.test(pw) && /\d/.test(pw), text: "Letters and at least one number" },
];

export default function ResetPasswordPage() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const token = params.get("token") ?? "";

    const [next, setNext] = useState("");
    const [again, setAgain] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const checks = rules(next);
    const ready = checks.every((c) => c.ok) && next === again;

    const save = async () => {
        setBusy(true); setError(null);
        try {
            await axios.post("/api/auth/reset-password", { token, newPassword: next });
            navigate("/login", { replace: true, state: { reset: true } });
        } catch (e) { setError(msg(e)); } finally { setBusy(false); }
    };

    if (!token) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-ink-50 p-4 dark:bg-ink-950">
                <div className="w-full max-w-sm border border-ink-200 bg-white p-8 dark:border-white/10 dark:bg-ink-900">
                    <p className="text-sm text-rose-600">Invalid or missing reset link.</p>
                    <Link to="/forgot-password" className="mt-3 block text-sm text-primary-600 hover:underline dark:text-primary-400">Request a new one</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-ink-50 p-4 dark:bg-ink-950">
            <form className="flex w-full max-w-sm flex-col gap-4 border border-ink-200 bg-white p-8 dark:border-white/10 dark:bg-ink-900"
                onSubmit={(e) => { e.preventDefault(); if (ready) void save(); }}>
                <div className="flex items-center gap-2">
                    <KeyRound className="text-brand-600" size={22} />
                    <span className="text-lg font-extrabold tracking-wide">RESET PASSWORD</span>
                </div>
                <p className="text-sm text-ink-500">Choose a new password for your account.</p>
                <Input type="password" label="New password" labelPlacement="outside" value={next} onValueChange={setNext} autoComplete="new-password" isRequired />
                <ul className="-mt-2 flex flex-col gap-1 text-xs">
                    {checks.map((c) => (
                        <li key={c.text} className={next ? (c.ok ? "text-emerald-600" : "text-rose-600") : "text-ink-500"}>
                            {next && c.ok ? "✓" : "•"} {c.text}
                        </li>
                    ))}
                </ul>
                <Input type="password" label="New password again" labelPlacement="outside" value={again} onValueChange={setAgain} autoComplete="new-password" isRequired
                    isInvalid={!!again && again !== next} errorMessage="The two passwords are different" />
                {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
                <Button type="submit" color="primary" isLoading={busy} isDisabled={!ready}>Set new password</Button>
                <Link to="/login" className="text-center text-sm text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">Back to sign in</Link>
            </form>
        </div>
    );
}
