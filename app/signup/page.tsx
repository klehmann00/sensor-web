// app/signup/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SignUpForm from '@/components/auth/SignUpForm';
import { useAuth } from '@/lib/hooks/useAuth';

export default function SignUpPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-2xl text-gray-700">Loading...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="mb-8 text-center">
        <h1 className="text-5xl font-bold text-gray-800 mb-2">Create Account</h1>
        <p className="text-gray-600">Join the sensor tracking platform</p>
      </div>

      <SignUpForm />
    </main>
  );
}
