"use client"
import React, { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { createUserProfile } from '@/app/actions/user'

export default function CreateAccount() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [step, setStep] = useState(1) // 1: initial form, 2: success (removed verification step)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')

  const getRedirectUrl = () => {
    const isLocalhost = process.env.NODE_ENV === 'development';
    const baseUrl = isLocalhost 
      ? 'http://localhost:3000'
      : 'https://vercel-frontend-v2.vercel.app';

    return baseUrl;
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    
    try {
      setLoading(true)
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getRedirectUrl(),
        },
      })

      if (authError) throw authError

      if (authData.user) {
        try {
          await createUserProfile(authData.user.id, {
            email,
            first_name: firstName,
            last_name: lastName,
            phone_number: phoneNumber || null,
            date_of_birth: dateOfBirth,
          })
        } catch (profileError) {
          console.error('Profile Error:', profileError)
          throw profileError
        }
      }

      setStep(2)
    } catch (error) {
      console.error('Full error:', error)
      setError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md mx-auto mt-10">
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {step === 1 && (
        <form onSubmit={handleSignUp} className="space-y-4">
          <div>
            <label className="block mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-2 border rounded"
              required
            />
          </div>
          <div>
            <label className="block mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-2 border rounded"
              required
            />
          </div>
          <div>
            <label className="block mb-2">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full p-2 border rounded"
              required
            />
          </div>
          <div>
            <label className="block mb-2">First Name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full p-2 border rounded"
              required
            />
          </div>
          <div>
            <label className="block mb-2">Last Name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full p-2 border rounded"
              required
            />
          </div>
          <div>
            <label className="block mb-2">Date of Birth</label>
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="w-full p-2 border rounded"
              required
            />
          </div>
          <div>
            <label className="block mb-2">Phone Number (optional)</label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full p-2 border rounded"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>
        </form>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-center mb-4">Check Your Email</h2>
          <p className="text-center text-gray-600">
            We&apos;ve sent a verification link to <span className="font-medium">{email}</span>.
          </p>
          <p className="text-center text-gray-600">
            Please click the link in the email to verify your account.
          </p>
          <p className="text-center text-sm text-gray-500 mt-4">
            Didn&apos;t receive the email? Check your spam folder or{' '}
            <button 
              onClick={handleSignUp} 
              className="text-blue-500 hover:underline"
              disabled={loading}
            >
              click here to resend
            </button>
          </p>
        </div>
      )}

      {step === 3 && (
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold text-green-600">Account Created Successfully!</h2>
          <p>You can now sign in with your email and password.</p>
          <Link href="/login" className="block text-blue-500 hover:underline">
            Go to Login
          </Link>
        </div>
      )}
    </div>
  )
} 