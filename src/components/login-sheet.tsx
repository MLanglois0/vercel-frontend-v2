"use client";

import * as Dialog from '@radix-ui/react-dialog';

interface LoginSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LoginSheet({ isOpen, onClose }: LoginSheetProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed right-0 top-0 h-full w-full max-w-md bg-white p-8 shadow-lg animate-slide-in">
          <Dialog.Title className="text-2xl font-bold mb-4">
            Login
          </Dialog.Title>
          
          {/* Add your login form here */}
          
          <Dialog.Close className="absolute top-4 right-4 text-gray-500 hover:text-gray-700">
            ✕
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
} 