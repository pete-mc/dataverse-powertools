interface Validator {
    // style: CSSStyleDeclaration;
    id: string;
    errormessage: string;
    validationGroup: string;
    initialvalue: string;
    controltovalidate: string;
    evaluationfunction: Function;
    data: object;
}