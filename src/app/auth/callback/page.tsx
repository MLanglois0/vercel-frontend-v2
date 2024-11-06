'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(true)

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const { error } = await supabase.auth.getSession()
        if (error) throw error

        // If we get here, the email was verified successfully
        setVerifying(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'An error occurred')
        setVerifying(false)
      }
    }

    handleCallback()
  }, [])

  if (verifying) {
    return (
      <div className="max-w-md mx-auto mt-10 text-center">
        <h2 className="text-xl font-semibold mb-4">Verifying your email...</h2>
        <div className="animate-pulse text-gray-600">Please wait</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto mt-10">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
        <Link 
          href="/create-account" 
          className="block text-center text-blue-500 hover:underline"
        >
          Return to Sign Up
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto mt-10 text-center space-y-4">
      <h2 className="text-2xl font-bold text-green-600">Email Verified Successfully!</h2>
      <p className="text-gray-600">Your account has been verified.</p>
      <div className="space-y-2">
        <Link 
          href="/login" 
          className="block w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600"
        >
          Go to Login
        </Link>
        <Link 
          href="/" 
          className="block text-blue-500 hover:underline"
        >
          Return to Home
        </Link>
      </div>
    </div>
  )
} 