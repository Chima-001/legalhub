 const MAXIMS = [{
      latin: "actus non facit reum nisi mens sit rea",
      meaning: "The act does not make a person guilty unless the mind is also guilty.",
      context: "Criminal law · mens rea principle"
    }, {
      latin: "audi alteram partem",
      meaning: "Hear the other side.",
      context: "Natural justice · right to fair hearing"
    }, {
      latin: "nemo judex in causa sua",
      meaning: "No one should be a judge in his own cause.",
      context: "Natural justice · rule against bias"
    }, {
      latin: "ubi jus ibi remedium",
      meaning: "Where there is a right, there is a remedy.",
      context: "Equity · access to justice"
    }, {
      latin: "res ipsa loquitur",
      meaning: "The thing speaks for itself.",
      context: "Tort · negligence · burden of proof"
    }, {
      latin: "volenti non fit injuria",
      meaning: "To a willing person, no injury is done.",
      context: "Tort · consent defence"
    }, {
      latin: "in loco parentis",
      meaning: "In the place of a parent.",
      context: "Family law · education · duty of care"
    }, {
      latin: "mens rea",
      meaning: "Guilty mind.",
      context: "Criminal law · mental element of crime"
    }, {
      latin: "actus reus",
      meaning: "Guilty act.",
      context: "Criminal law · physical element of crime"
    }, {
      latin: "ignorantia juris non excusat",
      meaning: "Ignorance of the law is no excuse.",
      context: "Legal maxim · presumption of knowledge"
    }, {
      latin: "nemo dat quod non habet",
      meaning: "No one gives what he does not have.",
      context: "Property law · transfer of title"
    }, {
      latin: "ei incumbit probatio qui dicit",
      meaning: "The burden of proof lies on the one who asserts.",
      context: "Evidence · burden of proof"
    }, {
      latin: "doli incapax",
      meaning: "Incapable of crime.",
      context: "Criminal law · infantia · age of criminal responsibility"
    }, {
      latin: "sub judice",
      meaning: "Under judgment.",
      context: "Legal procedure · matter pending in court"
    }, {
      latin: "prima facie",
      meaning: "At first sight; on the face of it.",
      context: "Evidence · presumption · threshold"
    }, {
      latin: "caveat emptor",
      meaning: "Let the buyer beware.",
      context: "Contract law · sale of goods"
    }, {
      latin: "contra proferentem",
      meaning: "Against the offeror.",
      context: "Contract interpretation · ambiguous terms"
    }, {
      latin: "de minimis non curat lex",
      meaning: "The law does not concern itself with trifles.",
      context: "Legal maxim · trivial matters"
    }, {
      latin: "noscitur a sociis",
      meaning: "A word is known by the company it keeps.",
      context: "Statutory interpretation · context"
    }, {
      latin: "stare decisis",
      meaning: "To stand by things decided.",
      context: "Judicial precedent · common law"
    }];

    const BRIGHT_GRADIENTS = [
      'linear-gradient(135deg, #4facfe, #00f2fe)',
      'linear-gradient(135deg, #43e97b, #38f9d7)',
      'linear-gradient(135deg, #f6d365, #fda085)',
      'linear-gradient(135deg, #a18cd1, #fbc2eb)',
      'linear-gradient(135deg, #48c6ef, #6f86d6)',
      'linear-gradient(135deg, #96e6a1, #d4fc79)',
      'linear-gradient(135deg, #f093fb, #f5576c)',
      'linear-gradient(135deg, #4facfe, #00f2fe)',
    ];

    const latinEl = document.getElementById('maximLatin');
    const meaningEl = document.getElementById('maximMeaning');
    const contextEl = document.getElementById('maximContext');
    const tagEl = document.getElementById('maximTag');
    const cardEl = document.getElementById('maximCard');

    let currentIndex = 0;
    let autoInterval = null;
    const AUTO_DELAY = 6000;

    function renderMaxim(index) {
      const m = MAXIMS[index];
      latinEl.textContent = m.latin;
      meaningEl.textContent = m.meaning;
      contextEl.textContent = '🔹 ' + m.context;
      tagEl.textContent = 'maxim';
      const grad = BRIGHT_GRADIENTS[index % BRIGHT_GRADIENTS.length];
      cardEl.style.background = grad;
      cardEl.style.color = '#1e293b';
    }

    function next() {
      currentIndex = (currentIndex + 1) % MAXIMS.length;
      renderMaxim(currentIndex);
    }

    function startAutoRotate() {
      if (autoInterval) clearInterval(autoInterval);
      autoInterval = setInterval(next, AUTO_DELAY);
    }

    function stopAutoRotate() {
      if (autoInterval) { clearInterval(autoInterval); autoInterval = null; }
    }

    renderMaxim(0);
    startAutoRotate();
    cardEl.addEventListener('mouseenter', stopAutoRotate);
    cardEl.addEventListener('mouseleave', startAutoRotate);
    cardEl.addEventListener('touchstart', stopAutoRotate);
    cardEl.addEventListener('touchend', startAutoRotate);

    // ──────────────────────────────────────────────────────────────
    //  2. PAST QUESTIONS DATA – extracted from PDF (clean)
    // ──────────────────────────────────────────────────────────────
    const PAST_QUESTIONS = {
      "2019": `FACULTY OF LAW, UNIVERSITY OF NIGERIA, ENUGU CAMPUS SECOND SEMESTER EXAMINATION LAW 132: LEGAL METHODS II DATE: 28 AUGUST, 2019 | TIME ALLOWED: TWO HOURS INSTRUCTION: ANSWER THREE QUESTIONS, AT LEAST ONE FROM EACH SECTION

        SECTION A

        1. In Obi v. Emeka, the Supreme Court was called upon to rule on the following issues for determination: a. Whether the Court of Appeal was right when it held that the decision of the High Court which did not consider the Supreme Court decision in Ese v. Malemi was right because that decision would not have affected the decision of the Court even if the Court was aware of its existence? b. Whether the decision of the Court of Appeal was correct since it failed to take note of the Rule of Court that was binding on it? c. Whether the Court of Appeal was right to hold that the decision of the Supreme Court in Obi v. Amaka was per incuriam and was not binding on the Court? d. Whether the Court of Appeal was right in using the term overruling when pronouncing its decision changing the decision of the lower court? Write your opinion on the above issues.

    2. With the aid of decided cases, discuss how the courts have interpreted and applied the repugnancy test for the validity of customary laws.

    SECTION B
    3. The main purpose of interpretation of statutes is to enable the court apply statutes properly and to also avoid injustice which may result from wrongful application of a statute. Write concisely on the following canons of interpretation; leaving your answers with statutory and judicial authorities:
    (a) The Literal Rule (b) The Golden Rule (c) The Mischief Rule

    4a) While it is relatively easy to make laws in a military regime, the process is rigorous and cumbersome in a civilian or democratic regime as it involves many stages. Discuss.
    4b. Highlight and briefly explain the qualities of a good draftsman.

    5a. Examine the significance of the library and research to a lawyer or a law student.
    5b. Examine the importance of the library catalogue and call numbers in assisting a researcher with materials in the library.
    5c. Distinguish distinctly between periodicals and books in the library.
    5d. Enumerate and explain the various ways of identifying books in the library.`,

      "2020": ` UNIVERSITY OF NIGERIA, ENUGU CAMPUS FACULTY OF LAW SECOND SEMESTER EXAMINATION | 2019/2020 SESSION | DATE: 28/6/21 LAW 132: LEGAL METHODS 2 | TIME ALLOWED: 2HRS INSTRUCTIONS: ATTEMPT ANY THREE QUESTIONS AND AT LEAST ONE QUESTION FROM EACH SECTION.

        Section A
        1a. Max Bobby, a first timer, is the senator representing his constituency in the 9th assembly of the Federal Republic of Nigeria. Distinguished Senator Bobby is greatly unhappy that his state is the only state in the country without a federal university. He intends sponsoring a bill to that effect with hopes that it becomes a law for a federal university to be established in his state. As a legal drafting expert, educate him on the stages the bill will undergo.
          1b. How is law making in military regimes different from that of democratic regimes? 
          
          2a. The duties of a draftsman are very tasking and require exceptional intellectual competence. Discuss, highlighting and explaining the qualities of a good draftsman. 
          
          2b. A Code is a specie of statute which seeks to sum up or bring together/compile the existing legislation and case law on a particular topic. Discuss the above statement in relation to types, qualities, critique and possible solutions to the perceived disadvantages of codification. 
          3. The main purpose of interpretation of statutes is to enable the court apply statutes properly and to also avoid injustice which may result from wrongful application of a statute. Write concisely on the following canons of interpretation; facing your answers with statutory and judicial authorities: 
          (i) The Literal Rule 
          (ii) The Golden Rule 
          (iii) The Mischief Rule

        SECTION B
        4. Mr. Nda Onyeabor died intestate leaving a wife, Ngozi, and three daughters Grace, Mercy and Chidinma Onyeabor behind. His nephew, Mr. Okoli Onyeabor as his only surviving male relative claimed that based on the Oli-Ekpe custom, he was entitled to inherit his uncle's property. The Oli-ekpe custom prohibits the inheritance rights of females and provides that the eldest male in the family will inherit from the deceased. The custom further provides that where the male issue of the direct line is deceased, the first son of the late brother of the deceased, the nephew or 'Oli-ekpe' will inherit his property. Mr. Nda Onyeabor's daughters instituted proceedings in the High Court in Anambra State whereupon the court upheld the 'Oli-ekpe' custom and judgment was granted in favour of Okoli Onyeabor. Aggrieved the Onyeabor daughters have come to you for help. Relying on the relevant sections of the Constitution, as well as the case of Mojekwu v Mojekwu [1997] 7 NWLR 283 where the court held that the Oli-ekpe custom is discriminatory, you have decided to appeal the case. a. Describe the parts of an appellant’s brief detailing their individual functions. b. Prepare the appellants’ brief using the facts above. 5a. A library is to a lawyer as a laboratory is to a scientist. Discuss. 

        5b. Ms. Julie got married to Chief Mike Arubi on the 4th day of March, 2021 at St Paul's Catholic Church Ekenwa, Benin City in Edo State. With her new status, Ms. Julie now officially desires to have a change of name. How would she do this using an affidavit of not more than six paragraphs? In what other ways can an affidavit be used?`,

      "2021": ` UNIVERSITY OF NIGERIA, ENUGU CAMPUS FACULTY OF LAW SECOND SEMESTER EXAMINATION | 2020/2021 SESSION LAW 132: LEGAL METHODS II | TIME ALLOWED: 2HRS INSTRUCTION: ATTEMPT THREE QUESTIONS. ONE QUESTION AT LEAST MUST BE ANSWERED FROM EACH SECTION.

SECTION A

1. “The draftsman... conceived certainty, but brought forth obscurity, sometimes even absurdity” (Lord Denning in his book, The Discipline of Law). In such a situation, the law becomes an ass. With the aid of legal authorities, explain how the Legislature can mitigate such misinterpretation of statute law.

2. A proposed law could eventually become a law subject to certain laid down procedures. Outline and discuss these procedures.

SECTION B 
3. Chidinma Agbo and Mercy Edet, students of UNEC resident at New Hostel, were arraigned at the High Court for playing Davido’s latest song next to Wizkid’s daughter’s bed. They were convicted for offending the sensibilities of the daughter of a high-ranking citizen of the Federal Republic of Nigeria and sentenced to death by firing squad. Aggrieved, the girls have come to you for help. Relying on the judgment in Aoko v. Fagbemi & Anor (1961) 1 ANLR 400 as well as the relevant section of the Constitution, section 36(12), which expressly states that a person shall not be convicted of an offence not known to Law, you have decided to appeal the case. a. Prepare the appellants’ brief using the facts above. b. Briefly discuss the effect of failure to file briefs within the period prescribed by law. 


4a. John was robbed on his way back from school on the 4th day of November, 2022 at the New Haven junction, Enugu, Enugu State. He lost his national ID cards, cellphone and laptop. He desires to make an official report at the New Haven police station. How would he do this using an affidavit of not more than six paragraphs? 4b. Law libraries play a vital role in the lives of legal professionals. Discuss. 


5a. Explain what you understand by the following concepts: i) Judicial Precedent ii) Ratio Decidendi iii) hierarchy of Nigerian Courts iv) Obiter Dicta. 5b. “Nigerian Legal system is an admixture of Received English Law and Customary/ Muslim Law”. Discuss.`,

      "2022": `UNIVERSITY OF NIGERIA, ENUGU CAMPUS FACULTY OF LAW FIRST SEMESTER EXAMINATION | 2021/2022 SESSION LAW 132: LEGAL METHOD II | 19/07/23 TIME ALLOWED: 2HOURS INSTRUCTIONS: ANSWER THREE QUESTIONS. (ONE FROM SECTION A AND TWO FROM SECTION B).

SECTION A

1. “The draftsman... conceived certainty, but brought forth obscurity, sometimes even absurdity” (Lord Denning in his book, The Discipline of Law). In such a situation, the law becomes an ass. With the aid of legal authorities, explain how the Courts can mitigate such misinterpretation of statute law. 

2a. What is brief writing?
 2b. Discuss the importance of brief writing. 
2c. A ground of appeal is capable of being defective. Do you agree? 2d. Discuss the consequences associated with failure to file briefs.

SECTION B
 3. Legislation is an important source of Nigerian law in that their provisions are binding as law- EA Ikegbu et al.... Discuss under these headings. (a) Statute law and Case law (b) Classification of statutes (c) Delegated legislation (d) Case law or precedent showing the different classification of precedents. 4a. With the aid of decided cases discuss PER CURIAM Judgement. 
 
 4b. The legislative processes in a democracy is different from the Military regime discuss. 4c. Outline the hierarchy of courts under Section 6(5) of the 1999 Constitution as amended. 
 4d. What are the ingredients of legal drafting?
 
 
 5. Austin, a First year Law student of Madonna University Elele applied for internship at Peterson & Associates, a reputable law firm in Lagos State for the period spanning across the Second Semester holidays. During the interview, he was asked to briefly explain the following types or methods of legal research available to legal researchers: a. Descriptive Legal Research b. Quantitative research c. Qualitative Legal Research d. Analytical Legal Research, and e. Applied Legal Research What would be your response if you were the applicant at that interview?`,

      "2023": ` UNIVERSITY OF NIGERIA, ENUGU CAMPUS FACULTY OF LAW SECOND SEMESTER EXAMINATION | 2022/2023 SESSION LAW 132: LEGAL METHODS II | DATE: 12/03/24 | TIME ALLOWED: 2HRS INSTRUCTIONS: ATTEMPT THREE QUESTIONS. AT LEAST ONE QUESTION FROM EACH SECTION. BEGIN A NEW QUESTION ON A SEPARATE SHEET.

SECTION A

1. The Nigerian Senators, in its sitting on the 27th of May 2022 extensively deliberated on the matter of national security including measures needed to contain the proliferation of firearms and light weapons in the country. Senators in their various contributions in the plenary expressed concerns that all Nigerians are threatened by insecurity due to kidnapping and ransom demand that are usually heavy. More than ever, they argued that the insecurity is the worst situation being faced in the present day of Nigeria. They reiterated the need to rise to the above challenges. In their opinion if the nation is to survive, steps must be taken to defend and secure lives and properties. The Senators have now resolved that the way forward is to legislate against the possession of firearms, ammunitions and explosives by the citizens. Mr. Grant, an observer at the house sitting afterwards in his discussion with his friends argued that the way to go is to allow citizens in the country to carry arms as a self-defence mechanism against these kidnappers similar to what obtains in other countries. Furthermore, he informed his friends in confidence that he may have no choice but to consider suing the entire National Assembly should they proceed to legislate against the use of firearms, ammunitions and explosives. (a) Supposing the Senators are willing to legislate against the use of fire arms, ammunitions and explosives in Nigeria, discuss the procedures required in achieving this. (b) Assuming Mr. Grant intends to sue the National Assembly for legislating on fire arms and light weapons, which court will have jurisdiction over the case? Give reasons for your answer. (c) List and briefly discuss five (5) features of good legislative drafting.

2. Agnes is the only surviving child of her parents who died recently in an auto crash. She intends to inherit the property of her parents at Nsukka but her uncles and aunties are strongly opposed to this because of the age-long tradition of the land that forbids a female child from such inheritance. Her uncles and aunties are bragging that she cannot do anything about it. She has decided to challenge the matter in court. Discuss the legal issues and advise her accordingly.

SECTION B

3. “It is a very useful rule in the construction of a statute to adhere to the ordinary meaning of the words used, and to the grammatical construction unless that is at variance with the intention of the legislature to be collected from the statute itself, or lead to manifest absurdity or repugnant, in which case the language may be modified so as to avoid such inconvenience, but no further.” (Becke v Smith). Discuss. 

4a. A well written brief comprises some necessary components. Outline and discuss such necessary components. 4b. Discuss the principles associated with the formulation of grounds of appeal.

5. Briefly discuss the following and demonstrate how they aid in legal research. (i) Law citators. (ii) Law digest. (iii) Law journals. (iv) Law Dictionaries.`,

      "2024": `UNIVERSITY OF NIGERIA, ENUGU CAMPUS FACULTY OF LAW SECOND SEMESTER EXAMINATION | 2023/2024 SESSION LAW 132: LEGAL METHOD 2 | 10/12/24 TIME ALLOWED: 2 HOURS INSTRUCTIONS: ANSWER THREE QUESTIONS IN ALL. AT LEAST ONE QUESTION MUST BE ANSWERED FROM EACH SECTION.

SECTION A

1. “The draftsman... conceived certainty, but brought forth obscurity, sometimes even absurdity” (Lord Denning in his book, The Discipline of Law). In such a situation, the law becomes an ass. With the aid of legal authorities, explain how the Legislature can mitigate such misinterpretation of statute law. 

2a. A well written brief has various segments. Discuss. 2b. Failure to file briefs has some unpleasant consequences. Expatiate. 2c. Discuss the relevance of law citators in legal research.

SECTION B 

3a. Write short notes on the following... (i) Judicial precedent (ii) Ratio Decidendi (iii) Obiter dictum 3b. With the aid of decided cases describe a Per Incuriam judgement and also mentioning the three ways per incuriam decision can be made. 

4. Walay took his matter to the Nigerian Industrial Court (NIC) to seek redress for a breach of his employees but he lost at the NIC. He came to you for advice because his employer’s lawyer taunted him claiming that he does not have the right to appeal. With the aid of decided case advise him whether his appeal is of right or otherwise. 4b. In line with the (Third Alteration) Act 2010 that amended the 1999 Constitution clearly state the hierarchy of courts in Nigeria. 

5. Evolving and establishing laws is not a mechanical or arbitrary exercise but is informed by the needs and aspirations of the people. M.E Ibanga. Learning Theory and Legal Method (Calabar; Associated Press Limited 1996) 221. Discuss in line with the following: (i) Types of Legislation (ii) Different stages of passage of a bill. (iv) Ingredients in Legal drafting.`,

      "2025": `UNIVERSITY OF NIGERIA, ENUGU CAMPUS FACULTY OF LAW SECOND SEMESTER EXAMINATION 2024/2025 LAW 132: LEGAL METHODS 2 | 23/09/25 TIME ALLOWED: 2HRS INSTRUCTIONS: ATTEMPT ANY THREE QUESTIONS, AAT LEAST ONE QUESTION FROM EACH SECTION.

SECTION A 1a. Common Law and Equity have some similarities but differ in their essential characteristics. Discuss, highlighting the differences between them. 1b. Does the doctrine of distinguishing go against the principle of precedent? Discuss, with reference to relevant legal authorities. 1c. Identify and briefly explain three ways in which a past judicial decision can be binding as precedent. 

2a. Legislation is an important source of Nigerian law in that their provisions are binding as law E.A Ikegbu et al. Discuss and differentiate between statute law and Case law. 2b. Discuss the necessity of delegated legislation and identify the various types of delegated legislation. 
2c. Highlight the process of legislation under the Military regime in Nigeria. 


3a. A court is not entitled to refuse to follow the decision of a higher court by which it is bound on the ground that it was given per incuriam - Okoegbu v The State. Discuss. 

3b. Nigeria has gone through the military and democratic regimes, which of the two regimes do you consider more suitable for Nigeria. Give at least five reasons for your answer. 3c. State the hierarchy of court under the 1999 constitution as amended.

SECTION B 

4a. It is trite that in a federal system, it is the responsibility of the legislature to make laws. However, in certain occasions the courts (judges) could be seen making laws. Explain.

4b. The Latin maxim ‘generalia specialibus non derogant’ is one of the rules of statutory interpretation. Discuss. 
5a. Discuss the purpose and importance of brief writing.
 5b. Under the relevant rules, failure to file briefs has certain legal consequences. Discuss. 
 5c. Discuss the relevance of law citators in legal research.`
    };

    const modalOverlay = document.getElementById('modalOverlay');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');
    const closeModalBtn = document.getElementById('closeModalBtn');

    function openModal(year) {
      const text = PAST_QUESTIONS[year] || 'No questions available for this year.';
      modalTitle.textContent = `${year} · Legal Method`;
      
      // split into lines, preserve structure, wrap in <p> for justified paper feel
      const lines = text.split('\n');
      let html = '<div class="question-block">';
      for (let line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') {
          html += '<br>';
        } else if (trimmed.match(/^[A-Z]{4,}/) || trimmed.match(/^SECTION/)) {
          // section headers
          html += `<strong style="display:block; margin-top:12px; font-size:1.1em;">${trimmed}</strong>`;
        } else {
          html += `<span style="display:block; text-align:justify; margin-bottom:4px;">${trimmed}</span>`;
        }
      }
      html += '</div>';
      modalContent.innerHTML = html;
      
      modalOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeModal() {
      modalOverlay.classList.remove('active');
      document.body.style.overflow = '';
    }

    // attach click to each menu item
    document.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', function(e) {
        const year = this.dataset.year;
        if (year) openModal(year);
      });
    });

    closeModalBtn.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', function(e) {
      if (e.target === this) closeModal();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeModal();
    });

    console.log('✅ Legal Method past questions ready (justified, full-screen).');