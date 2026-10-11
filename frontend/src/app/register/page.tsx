"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, registerRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!/^[A-Za-z0-9_-]{3,30}$/.test(username.trim())) {
      errors.username = "3-30 characters: letters, numbers, _ or -.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (password.length < 12) {
      errors.password = "Password must be at least 12 characters.";
    }
    if (displayName.trim().length > 50) {
      errors.displayName = "Display name must be at most 50 characters.";
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
      await registerRequest({
        username: username.trim(),
        email: email.trim(),
        password,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      });
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        const issues = err.issues
          ? Object.entries(err.issues)
              .filter(([, messages]) => messages?.length)
              .map(([field, messages]) => `${field}: ${messages!.join(", ")}`)
              .join(" ")
          : "";
        setServerError(issues ? `${err.message} ${issues}` : err.message);
      } else {
        setServerError("Something went wrong. Please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-10">
      <Link href="/" className="mb-8 text-lg font-semibold tracking-tight">
        CodePulse
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-cyan-300 hover:underline">
          Log in
        </Link>
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <div>
          <label htmlFor="username" className="mb-1 block text-sm text-slate-200">
            Username
          </label>
          <input
            id="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={inputClass}
            placeholder="code_ninja"
            suppressHydrationWarning
          />
          {fieldErrors.username && <p role="alert" className="mt-1 text-sm text-red-400">{fieldErrors.username}</p>}
        </div>
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
            suppressHydrationWarning
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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder="At least 12 characters"
            suppressHydrationWarning
          />
          {fieldErrors.password && <p role="alert" className="mt-1 text-sm text-red-400">{fieldErrors.password}</p>}
        </div>
        <div>
          <label htmlFor="displayName" className="mb-1 block text-sm text-slate-200">
            Display name <span className="text-muted">(optional)</span>
          </label>
          <input
            id="displayName"
            autoComplete="nickname"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
            placeholder="Ada Lovelace"
            suppressHydrationWarning
          />
          {fieldErrors.displayName && <p role="alert" className="mt-1 text-sm text-red-400">{fieldErrors.displayName}</p>}
        </div>

        {serverError && <p role="alert" className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">{serverError}</p>}

        <Button
          type="submit"
          size="lg"
          disabled={pending}
          className="w-full"
          suppressHydrationWarning
        >
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </main>
  );
}
