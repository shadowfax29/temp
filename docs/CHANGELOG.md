
## [2026-11-19] - OTP on screen for no-email accounts

### Frontend
- Login page: OTP banner text updated to remove "Development only" label; now shows for any environment when mail is not configured

### Backend
- /api/auth/login: removed environment gate on showCode; sign-in code is always returned in response when SMTP email fails to send, so admin accounts without a real email can sign in in production
