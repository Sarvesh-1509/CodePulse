"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, loginRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (password.length === 0) {
      errors.password = "Enter your password.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setServerError(null);
    if (!validate()) return;
    setPending(true);
    try {
      await loginRequest({ email: email.trim(), password });
      router.replace("/dashboard");
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-10">
      <Link href="/" className="mb-8 text-lg font-semibold tracking-tight">
        CodePulse
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
      <p className="mt-1 text-sm text-muted">
        New to CodePulse?{" "}
        <Link href="/register" className="text-cyan-300 hover:underline">
          Create an account
        </Link>
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm text-slate-200">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
          {fieldErrors.email && <p role="alert" className="mt-1 text-sm text-red-400">{fieldErrors.email}</p>}
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm text-slate-200">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder="Your password"
          />
          {fieldErrors.password && <p role="alert" className="mt-1 text-sm text-red-400">{fieldErrors.password}</p>}
        </div>

        {serverError && <p role="alert" className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">{serverError}</p>}

        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? "Logging in…" : "Log in"}
        </Button>
      </form>
    </main>
  );
}
