# Sensor Dashboard - Web

A Next.js web application for tracking and analyzing device sensor data in real-time, built with TypeScript, Tailwind CSS, and Firebase.

## Features

- **Real-time Sensor Data**: Access accelerometer and gyroscope data using the Device Motion API
- **Authentication**: Secure login/signup with Firebase Authentication
- **Data Recording**: Record and store sensor data sessions to Firebase
- **Admin Panel**: Manage users and view all recording sessions
- **Visual Analytics**: Real-time charts using Recharts
- **Mobile Support**: Optimized for mobile devices with sensor capabilities

## Tech Stack

- **Framework**: Next.js 15+ with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Backend**: Firebase (Auth + Realtime Database)
- **Charts**: Recharts
- **Sensors**: Web Device Motion API

## Project Structure

```
sensor-web/
├── app/
│   ├── page.tsx              # Login page
│   ├── signup/page.tsx       # Signup page
│   ├── dashboard/page.tsx    # Main sensor dashboard
│   └── admin/page.tsx        # Admin panel
├── components/
│   ├── auth/
│   │   ├── LoginForm.tsx
│   │   └── SignUpForm.tsx
│   └── sensors/
│       ├── SensorDisplay.tsx
│       ├── AccelerometerChart.tsx
│       └── GyroscopeChart.tsx
├── lib/
│   ├── firebase.ts           # Firebase configuration
│   ├── managers/
│   │   ├── AuthManager.ts
│   │   ├── StorageManager.ts
│   │   └── SessionManager.ts
│   ├── processors/
│   │   ├── SensorProcessor.ts
│   │   └── EnhancedSensorProcessor.ts
│   └── hooks/
│       ├── useSensors.ts
│       └── useAuth.ts
└── contexts/
    └── AdminContext.tsx
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Firebase

1. Create a Firebase project at [https://console.firebase.google.com](https://console.firebase.google.com)
2. Enable Authentication (Email/Password)
3. Enable Realtime Database
4. Copy your Firebase configuration
5. Update `.env.local` with your Firebase credentials:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-app.firebaseapp.com
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://your-app.firebaseio.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-app.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
```

### 3. Firebase Database Rules

Set up your Realtime Database rules:

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "$uid === auth.uid",
        ".write": "$uid === auth.uid"
      }
    },
    "sessions": {
      "$uid": {
        ".read": "$uid === auth.uid",
        ".write": "$uid === auth.uid"
      }
    },
    "sensorData": {
      "$uid": {
        ".read": "$uid === auth.uid",
        ".write": "$uid === auth.uid"
      }
    }
  }
}
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## Usage

### For End Users

1. **Sign Up**: Create an account with email and password
2. **Login**: Access your dashboard
3. **Grant Permission**: Click "Start Sensors" and allow motion sensor access
4. **View Data**: See real-time accelerometer and gyroscope data
5. **Record Sessions**: Click "Start Recording" to save data to Firebase
6. **View Charts**: Monitor sensor data trends in real-time

### For Admin Users

To make a user an admin, manually update their record in Firebase:

1. Go to Firebase Console > Realtime Database
2. Navigate to `users/{userId}`
3. Set `isAdmin: true`

Admin users can:
- Access the Admin Panel
- View all users
- See all recording sessions

## Device Motion API

This app uses the **Device Motion API** to access sensor data:

### Requirements

- **HTTPS**: Sensor access requires a secure connection
- **Mobile Device**: Desktop browsers may not have motion sensors
- **Permission**: iOS requires explicit user permission

### Browser Support

- ✅ iOS Safari (with permission)
- ✅ Chrome Android
- ✅ Firefox Android
- ⚠️  Desktop browsers (limited sensor availability)

## Deployment

### Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Make sure to add your environment variables in the Vercel dashboard.

### Important for Production

1. **HTTPS is required** for sensor access
2. Add environment variables to your hosting platform
3. Update Firebase Database rules for production
4. Test sensor permissions on target devices

## Architecture

### Data Flow

1. **Sensor Data Collection**: Device Motion API → `useSensors` hook
2. **Processing**: Raw data → `SensorProcessor` → Filtered/processed data
3. **Storage**: Processed data → `StorageManager` → Firebase
4. **Visualization**: Stored data → Charts → User interface

### Key Components

- **useSensors**: Custom hook for accessing device sensors
- **useAuth**: Authentication state management
- **SensorProcessor**: Data filtering and processing
- **StorageManager**: Firebase data operations
- **AdminContext**: Role-based access control

## Troubleshooting

### Sensors Not Working

- Ensure you're using HTTPS
- Check browser console for permission errors
- Try on a mobile device (desktop may not have sensors)
- Grant motion sensor permissions when prompted

### Firebase Errors

- Verify environment variables are set correctly
- Check Firebase Console for authentication/database status
- Ensure database rules allow read/write access

## Related Projects

This is the web companion to the **SensorTest** React Native app. Both share similar:
- Authentication system
- Data processing algorithms
- Firebase backend structure

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request
