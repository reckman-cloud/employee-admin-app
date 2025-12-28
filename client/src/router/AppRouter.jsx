import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import SignIn from '../screens/SignIn.jsx';
import Home from '../screens/Home.jsx';
import FormApp from '../FormApp.jsx';
import Offboard from '../screens/Offboard.jsx';
import RequireAdmin from '../security/RequireAdmin.jsx';

export default function AppRouter(){
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/signin" element={<SignIn/>} />
        <Route path="/" element={<RequireAdmin><Home/></RequireAdmin>} />
        <Route path="/form" element={<RequireAdmin><FormApp/></RequireAdmin>} />
        <Route path="/offboard" element={<RequireAdmin><Offboard/></RequireAdmin>} />
        <Route path="*" element={<Navigate to="/" replace/>} />
      </Routes>
    </BrowserRouter>
  );
}
