declare module '#auth-utils' {
  interface UserSession {
    userId: string
    identityId: string
    providerId: string
    sessionVersion: number
    loggedInAt: number
  }
}

export {}
