"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import LoginSheet from './LoginSheet'

export default function Nav() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    // Check initial auth state
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(!!session)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/') // Redirect to home page after logout
  }

  return (
    <>
      <nav className="bg-white shadow-lg">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex justify-between">
            <div className="flex space-x-7">
              <Link href="/" className="flex items-center py-4">
                <span className="font-bold">Audibloom</span>
              </Link>
              <Link href="/about" className="flex items-center py-4">
                About
              </Link>
              <Link href="/contact" className="flex items-center py-4">
                Contact
              </Link>
              <Link href="/services" className="flex items-center py-4">
                Services
              </Link>
            </div>
            
            <div className="flex items-center space-x-4">
              {!isLoggedIn ? (
                <>
                  <button
                    onClick={() => setIsLoginOpen(true)}
                    className="py-2 px-4 hover:text-blue-500"
                  >
                    Login
                  </button>
                  <Link href="/create-account" className="py-2 px-4 hover:text-blue-500">
                    Create Account
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/profile" className="py-2 px-4 hover:text-blue-500">
                    Profile
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="py-2 px-4 hover:text-blue-500"
                  >
                    Logout
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      <LoginSheet 
        isOpen={isLoginOpen} 
        onClose={() => setIsLoginOpen(false)} 
      />
    </>
  )
} 