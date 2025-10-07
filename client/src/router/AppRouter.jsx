import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import SignIn from '../screens/SignIn.jsx';
import FormApp from '../FormApp.jsx';
import RequireAdmin from '../security/RequireAdmin.jsx';

export default function AppRouter(){
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/signin" element={<SignIn/>} />
        <Route path="/" element={<RequireAdmin><FormApp/></RequireAdmin>} />
        <Route path="*" element={<Navigate to="/" replace/>} />
      </Routes>
    </BrowserRouter>
  );
}
