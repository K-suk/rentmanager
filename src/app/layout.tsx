import type { Metadata } from 'next';
import './style.css';
export const metadata: Metadata={title:'RentManager | 備品貸出管理',description:'架空の社員と備品を使った公開デモ'};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="ja"><body>{children}</body></html>; }
