// lib/hooks/useAuth.ts
'use client';

import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import AuthManager from '../managers/AuthManager';
import { auth, database } from '../firebase';

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Initialize AuthManager
    if (auth && database) {
      AuthManager.initialize(auth, database);
    }

    // Subscribe to auth changes
    const handleAuthChange = (newUser: User | null) => {
      setUser(newUser);
      setLoading(false);
    };

    AuthManager.subscribeToAuthChanges(handleAuthChange);

    return () => {
      AuthManager.unsubscribeFromAuthChanges(handleAuthChange);
    };
  }, []);

  const login = async (email: string, password: string) => {
    try {
      setError(null);
      await AuthManager.login(email, password);
    } catch (err: any) {
      setError(err.message || 'Login failed');
      throw err;
    }
  };

  const signup = async (email: string, password: string) => {
    try {
      setError(null);
      await AuthManager.signup(email, password);
    } catch (err: any) {
      setError(err.message || 'Signup failed');
      throw err;
    }
  };

  const logout = async () => {
    try {
      setError(null);
      await AuthManager.logout();
    } catch (err: any) {
      setError(err.message || 'Logout failed');
      throw err;
    }
  };

  return {
    user,
    loading,
    error,
    login,
    signup,
    logout
  };
};
