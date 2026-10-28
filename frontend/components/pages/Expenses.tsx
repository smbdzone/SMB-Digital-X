"use client";

import React from "react";
import Expenses from "@/components/expenses/Expenses";

// Admin sees every expense; an employee sees only their own (the API enforces this).
const ExpensesPage = () => {
    return (
        <div className="py-4 lg:py-6">
            <Expenses showProject={true} />
        </div>
    );
};

export default ExpensesPage;
