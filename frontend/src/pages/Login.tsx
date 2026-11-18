import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { Eye, EyeOff, Ticket } from "lucide-react";

import { Button, Input } from "@/components/ui";
import OtpInput from "@/components/OtpInput";
import { saveSession, type SessionUser } from "@/lib/auth";

interface Challenge { challengeId: string; emailHint: string; expiresInMinutes: number; devOtp?: string }
const msg = (e: any) => e?.response?.data?.message || e?.message || "Something went wrong.";

/** Step 1: email and password. Step 2: the 6-digit code that was sent to the email. */
export default function LoginPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const justReset = (location.state as { reset?: boolean } | null)?.reset === true;
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [challenge, setChallenge] = useState<Challenge | null>(null);
    const [code, setCode] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const done = (r: { token: string; user: SessionUser; mustChangePassword?: boolean }) => { saveSession(r.token, r.user, !!r.mustChangePassword); navigate(r.mustChangePassword ? "/change-password" : "/tickets", { replace: true }); };

    const signIn = async () => {
        setBusy(true); setError(null);
        try {
            const r = (await axios.post("/api/auth/login", { email, password })).data.response;
            if (r.needsOtp) { setChallenge(r); setCode(""); } else done(r);
        } catch (e) { setError(msg(e)); } finally { setBusy(false); }
    };

    const verify = async (c: string) => {
        if (!challenge || busy) return;
        setBusy(true); setError(null);
        try { done((await axios.post("/api/auth/verify-otp", { challengeId: challenge.challengeId, code: c })).data.response); }
        catch (e) { setError(msg(e)); setCode(""); } finally { setBusy(false); }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-ink-50 p-4 dark:bg-ink-950">
            <div className="w-full max-w-sm border border-ink-200 bg-white p-8 dark:border-white/10 dark:bg-ink-900">
                <div className="mb-6 flex items-center gap-2"><Ticket className="text-brand-600" size={22} /><span className="text-lg font-extrabold tracking-wide">TICKETING TOOL</span></div>
                {!challenge ? (
                    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void signIn(); }}>
                        <div><h1 className="text-xl font-bold">Sign in</h1><p className="text-sm text-ink-500">Use the email and password an admin gave you.</p></div>
                        {justReset && <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">Password updated. Sign in with your new password.</p>}
                        <Input type="email" label="Email" labelPlacement="outside" value={email} onValueChange={setEmail} autoComplete="username" isRequired />
                        <Input
                            type={showPw ? "text" : "password"}
                            label="Password"
                            labelPlacement="outside"
                            value={password}
                            onValueChange={setPassword}
                            autoComplete="current-password"
                            isRequired
                            endContent={
                                <button type="button" onClick={() => setShowPw((v) => !v)} className="text-ink-400 hover:text-ink-700 dark:hover:text-ink-200" tabIndex={-1} aria-label={showPw ? "Hide password" : "Show password"}>
                                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            }
                        />
                        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
                        <Button type="submit" color="primary" isLoading={busy} isDisabled={!email || !password}>Continue</Button>
                        <Link to="/forgot-password" className="text-center text-xs text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">Forgot password?</Link>
                    </form>
                ) : (
                    <div className="flex flex-col gap-4">
                        <div><h1 className="text-xl font-bold">Enter your code</h1>
                            <p className="text-sm text-ink-500">We sent a 6-digit code to {challenge.emailHint}. It works for {challenge.expiresInMinutes} minutes.</p></div>
                        <OtpInput value={code} onChange={setCode} onComplete={verify} isInvalid={!!error} isDisabled={busy} />
                        {challenge.devOtp && (
                            <p className="border border-dashed border-amber-400 bg-amber-50 p-2 text-center text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                                Development only: no mail server is set up, so the code is shown here: <b className="tracking-widest">{challenge.devOtp}</b>
                            </p>
                        )}
                        {error && <p role="alert" className="text-center text-sm text-rose-600">{error}</p>}
                        <Button color="primary" isLoading={busy} isDisabled={code.length !== 6} onPress={() => verify(code)}>Sign in</Button>
                        <Button variant="light" onPress={() => { setChallenge(null); setError(null); setPassword(""); }}>Back</Button>
                    </div>
                )}
            </div>
        </div>
    );
}
