// lib/managers/SessionManager.ts
class SessionManager {
  private static SESSION_KEY = 'sensor_session';
  private static SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  static startNewSession(): void {
    if (typeof window === 'undefined') return;

    const session = {
      startTime: Date.now(),
      isValid: true
    };

    localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
  }

  static async isSessionValid(): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    const sessionData = localStorage.getItem(this.SESSION_KEY);

    if (!sessionData) {
      return false;
    }

    try {
      const session = JSON.parse(sessionData);
      const currentTime = Date.now();
      const elapsed = currentTime - session.startTime;

      return session.isValid && elapsed < this.SESSION_DURATION;
    } catch (error) {
      console.error('Error checking session:', error);
      return false;
    }
  }

  static endSession(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(this.SESSION_KEY);
  }
}

export default SessionManager;
