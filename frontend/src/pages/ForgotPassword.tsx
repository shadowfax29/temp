import { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { Ticket } from "lucide-react";

import { Button, Input } from "@/components/ui";

const msg = (e: any) => e?.response?.data?.message || e?.message || "Something went wrong.";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        setBusy(true); setError(null);
        try {
            await axios.post("/api/auth/forgot-password", { email });
            setSent(true);
        } catch (e) { setError(msg(e)); } finally { setBusy(false); }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-ink-50 p-4 dark:bg-ink-950">
            <div className="w-full max-w-sm border border-ink-200 bg-white p-8 dark:border-white/10 dark:bg-ink-900">
                <div className="mb-6 flex items-center gap-2">
                    <Ticket className="text-brand-600" size={22} />
                    <span className="text-lg font-extrabold tracking-wide">TICKETING TOOL</span>
                </div>
                {sent ? (
                    <div className="flex flex-col gap-4">
                        <div>
                            <h1 className="text-xl font-bold">Check your email</h1>
                            <p className="mt-1 text-sm text-ink-500">
                                If <strong>{email}</strong> matches an account, we sent a reset link. It works for 1 hour.
                            </p>
                        </div>
                        <Link to="/login" className="text-sm text-primary-600 hover:underline dark:text-primary-400">Back to sign in</Link>
                    </div>
                ) : (
                    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                        <div>
                            <h1 className="text-xl font-bold">Forgot password?</h1>
                            <p className="mt-1 text-sm text-ink-500">Enter your email and we will send you a reset link.</p>
                        </div>
                        <Input type="email" label="Email" labelPlacement="outside" value={email} onValueChange={setEmail} autoComplete="email" isRequired />
                        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
                        <Button type="submit" color="primary" isLoading={busy} isDisabled={!email}>Send reset link</Button>
                        <Link to="/login" className="text-center text-sm text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">Back to sign in</Link>
                    </form>
                )}
            </div>
        </div>
    );
}
