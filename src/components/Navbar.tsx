import React from 'react'
import Link from 'next/link'

export default function Navbar() {
  return (
    <nav className="bg-white shadow">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <Link href="/" className="flex items-center">
              Home
            </Link>
          </div>
          <div className="flex items-center">
            <Link href="/auth/signin" className="text-gray-700 hover:text-gray-900 px-3 py-2">
              Sign In
            </Link>
            <Link href="/auth/signup" className="text-gray-700 hover:text-gray-900 px-3 py-2">
              Sign Up
            </Link>
          </div>
        </div>
      </div>
    </nav>
  )
} 