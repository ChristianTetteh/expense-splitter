import { Routes, Route } from "react-router-dom";
import Header from "./components/Header.jsx";
import CreateGroup from "./pages/CreateGroup.jsx";
import GroupView from "./pages/GroupView.jsx";

export default function App() {
  return (
    <div className="app">
      <Header />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<CreateGroup />} />
          <Route path="/groups/:id" element={<GroupView />} />
        </Routes>
      </main>
    </div>
  );
}
