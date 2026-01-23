// lib/managers/AuthManager.ts
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
  Auth
} from 'firebase/auth';
import { ref, set, Database } from 'firebase/database';

class AuthManager {
  private auth: Auth | null = null;
  private database: Database | null = null;
  private authStateListeners: ((user: User | null) => void)[] = [];

  initialize(auth: Auth, database: Database) {
    this.auth = auth;
    this.database = database;

    // Set up auth state listener
    onAuthStateChanged(auth, (user) => {
      this.authStateListeners.forEach(listener => listener(user));
    });
  }

  async login(email: string, password: string): Promise<User> {
    if (!this.auth) throw new Error('AuthManager not initialized');

    const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
    return userCredential.user;
  }

  async signup(email: string, password: string): Promise<User> {
    if (!this.auth || !this.database) throw new Error('AuthManager not initialized');

    const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
    const user = userCredential.user;

    // Create user profile in database
    await set(ref(this.database, `users/${user.uid}`), {
      email: user.email,
      createdAt: Date.now(),
      isAdmin: false
    });

    return user;
  }

  async logout(): Promise<void> {
    if (!this.auth) throw new Error('AuthManager not initialized');
    await signOut(this.auth);
  }

  getCurrentUser(): User | null {
    return this.auth?.currentUser || null;
  }

  getCurrentUserId(): string | null {
    return this.auth?.currentUser?.uid || null;
  }

  subscribeToAuthChanges(callback: (user: User | null) => void) {
    this.authStateListeners.push(callback);
  }

  unsubscribeFromAuthChanges(callback: (user: User | null) => void) {
    this.authStateListeners = this.authStateListeners.filter(cb => cb !== callback);
  }
}

export default new AuthManager();
